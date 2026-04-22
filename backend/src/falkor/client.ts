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
