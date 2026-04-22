// Minimal FalkorDB client — talks to FalkorDB via the Redis RESP protocol
// using Bun's built-in TCP socket API.  We avoid the npm driver so the only
// dependency stays `bun` itself.
//
// Supports just enough to:
//   - GRAPH.QUERY <graph> <cypher>
//   - GRAPH.DELETE <graph>
//   - ping (standard PING)

import { connect } from "node:net";

const HOST = process.env.FALKOR_HOST ?? "localhost";
const PORT = Number(process.env.FALKOR_PORT ?? "6379");

function encodeRESP(args: string[]): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const a of args) parts.push(`$${Buffer.byteLength(a)}\r\n${a}\r\n`);
  return Buffer.from(parts.join(""));
}

// Streaming RESP parser — handles integers, bulk strings, simple strings,
// errors, and arrays (recursive).
function parseRESP(buf: Buffer, offset: number): { value: any; next: number } | null {
  if (offset >= buf.length) return null;
  const type = String.fromCharCode(buf[offset]!);
  if (type === "+") {
    const end = buf.indexOf(Buffer.from("\r\n"), offset);
    if (end === -1) return null;
    return { value: buf.toString("utf8", offset + 1, end), next: end + 2 };
  }
  if (type === "-") {
    const end = buf.indexOf(Buffer.from("\r\n"), offset);
    if (end === -1) return null;
    throw new Error(`FalkorDB: ${buf.toString("utf8", offset + 1, end)}`);
  }
  if (type === ":") {
    const end = buf.indexOf(Buffer.from("\r\n"), offset);
    if (end === -1) return null;
    return { value: Number(buf.toString("utf8", offset + 1, end)), next: end + 2 };
  }
  if (type === "$") {
    const end = buf.indexOf(Buffer.from("\r\n"), offset);
    if (end === -1) return null;
    const len = Number(buf.toString("utf8", offset + 1, end));
    if (len === -1) return { value: null, next: end + 2 };
    const start = end + 2;
    if (start + len + 2 > buf.length) return null;
    return { value: buf.toString("utf8", start, start + len), next: start + len + 2 };
  }
  if (type === "*") {
    const end = buf.indexOf(Buffer.from("\r\n"), offset);
    if (end === -1) return null;
    const len = Number(buf.toString("utf8", offset + 1, end));
    if (len === -1) return { value: null, next: end + 2 };
    let cursor = end + 2;
    const arr: any[] = [];
    for (let i = 0; i < len; i++) {
      const el = parseRESP(buf, cursor);
      if (!el) return null;
      arr.push(el.value);
      cursor = el.next;
    }
    return { value: arr, next: cursor };
  }
  throw new Error(`unexpected RESP type: ${type}`);
}

class FalkorConn {
  private socket: ReturnType<typeof connect> | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Array<(v: any) => void> = [];
  private errQueue: Array<(e: Error) => void> = [];

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket = connect({ host: HOST, port: PORT }, () => resolve());
      this.socket.on("error", reject);
      this.socket.on("data", (chunk) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      this.socket.on("close", () => {
        const err = new Error("connection closed");
        this.errQueue.forEach((r) => r(err));
        this.queue = []; this.errQueue = [];
      });
    });
  }

  close(): void {
    this.socket?.end();
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (!this.queue.length) return;
      let parsed: ReturnType<typeof parseRESP> = null;
      try {
        parsed = parseRESP(this.buf, 0);
      } catch (e) {
        const err = this.errQueue.shift();
        this.queue.shift();
        err?.(e as Error);
        this.buf = Buffer.alloc(0);
        continue;
      }
      if (!parsed) return;
      const res = this.queue.shift(); this.errQueue.shift();
      this.buf = this.buf.subarray(parsed.next);
      res?.(parsed.value);
    }
  }

  send(args: string[]): Promise<any> {
    if (!this.socket) throw new Error("not connected");
    const payload = encodeRESP(args);
    return new Promise((resolve, reject) => {
      this.queue.push(resolve);
      this.errQueue.push(reject);
      this.socket!.write(payload);
    });
  }
}

let shared: FalkorConn | null = null;
async function conn(): Promise<FalkorConn> {
  if (shared) return shared;
  shared = new FalkorConn();
  await shared.connect();
  return shared;
}

export async function ping(): Promise<boolean> {
  try {
    const c = await conn();
    const r = await c.send(["PING"]);
    return r === "PONG";
  } catch {
    return false;
  }
}

export async function graphQuery(graph: string, cypher: string): Promise<any> {
  const c = await conn();
  return await c.send(["GRAPH.QUERY", graph, cypher, "--compact"]);
}

export async function graphQueryRaw(graph: string, cypher: string): Promise<any> {
  const c = await conn();
  return await c.send(["GRAPH.QUERY", graph, cypher]);
}

export async function graphDelete(graph: string): Promise<void> {
  try {
    const c = await conn();
    await c.send(["GRAPH.DELETE", graph]);
  } catch {
    /* graph didn't exist */
  }
}

// FalkorDB returns arrays [columns, rows, stats]; rows are arrays of scalar
// values. For this project we only need answer counts — extract from stats or
// via row length.
export function answerCount(result: any): number {
  if (!Array.isArray(result) || result.length < 3) return 0;
  const rows = result[1];
  if (Array.isArray(rows)) return rows.length;
  // Write queries have [ok, stats]; count is derivable from "Nodes created" etc.
  return 0;
}

export function close(): void {
  shared?.close(); shared = null;
}

export interface FalkorNode { id: string; label: string; props: Record<string, unknown> }
export interface FalkorEdge { type: string; src: string; dst: string; srcLabel: string; dstLabel: string }
export interface FalkorGraph { nodes: FalkorNode[]; edges: FalkorEdge[] }
export interface FalkorDumpOptions { maxEdges?: number }

// Compact format returns arrays of tuples; index into them defensively
// because subtle rev differences in FalkorDB reshape the rows.
function asValue(cell: any): any {
  if (cell == null) return null;
  if (Array.isArray(cell) && cell.length >= 2) return cell[1]; // [type, value]
  return cell;
}
function asId(val: any, ids: Map<number, string>): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return ids.get(val) ?? String(val);
  if (val && typeof val === "object" && val.properties) {
    for (const p of val.properties) if (asValue(p[0]) === "id" || p.name === "id") return String(asValue(p[1] ?? p.value));
  }
  return String(val);
}

export async function graphDump(graph: string, opts: FalkorDumpOptions = {}): Promise<FalkorGraph> {
  const nodes: FalkorNode[] = [];
  const edges: FalkorEdge[] = [];
  const maxEdges = opts.maxEdges ?? 0; // 0 = no cap
  try {
    const nres = await graphQueryRaw(graph, "MATCH (n) RETURN labels(n)[0] AS label, n.id AS id");
    const nrows = nres?.[1] ?? [];
    for (const row of nrows) {
      const label = String(row[0] ?? "");
      const id = String(row[1] ?? "");
      if (id) nodes.push({ id, label, props: {} });
    }

    const limit = maxEdges > 0 ? ` LIMIT ${maxEdges}` : "";
    const eres = await graphQueryRaw(graph,
      "MATCH (a)-[r]->(b) RETURN type(r) AS t, labels(a)[0] AS la, a.id AS aid, labels(b)[0] AS lb, b.id AS bid" + limit);
    const erows = eres?.[1] ?? [];
    for (const row of erows) {
      const type = String(row[0] ?? "");
      const srcLabel = String(row[1] ?? "");
      const src = String(row[2] ?? "");
      const dstLabel = String(row[3] ?? "");
      const dst = String(row[4] ?? "");
      if (type && src && dst) edges.push({ type, src, dst, srcLabel, dstLabel });
    }
  } catch {
    /* return whatever we have */
  }
  return { nodes, edges };
}

export async function graphStats(graph: string): Promise<{ nodes: number; edges: number }> {
  try {
    const nodesRes = await graphQuery(graph, "MATCH (n) RETURN count(n)");
    const edgesRes = await graphQuery(graph, "MATCH ()-[r]->() RETURN count(r)");
    // Compact payload: result[1] is the rows array; first row first column is
    // the count as an integer (or an object with { value } depending on build).
    const nodes = Number((nodesRes?.[1]?.[0]?.[0]?.[1] ?? nodesRes?.[1]?.[0]?.[0]) ?? 0);
    const edges = Number((edgesRes?.[1]?.[0]?.[0]?.[1] ?? edgesRes?.[1]?.[0]?.[0]) ?? 0);
    return { nodes, edges };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}
