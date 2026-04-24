// Load the schema + generated dataset into TypeDB 3.x via its HTTP API.
//
//   bun run backend/src/cmd/load.ts
//   bun run backend/src/cmd/load.ts --reset
//
// Endpoints used (verified against CE 3.10):
//   POST /v1/signin                    -> { token }
//   GET  /v1/databases                 -> { databases: [ { name }, ... ] }
//   POST /v1/databases/{name}          -> 200  (create)
//   DELETE /v1/databases/{name}        -> 200  (drop)
//   POST /v1/query                     -> { answerType, answers }
//     body: { databaseName, query, transactionType: "read"|"write"|"schema", commit }

import { readFile } from "node:fs/promises";
import path from "node:path";

const HTTP_BASE = process.env.TYPEDB_HTTP ?? "http://localhost:28000";
const DATABASE  = process.env.TYPEDB_DATABASE ?? "n_ary";
const USER      = process.env.TYPEDB_USER ?? "admin";
const PASSWORD  = process.env.TYPEDB_PASSWORD ?? "password";
const BATCH     = Number(process.env.BATCH ?? "25");
const RESET     = Bun.argv.includes("--reset");

async function signin(): Promise<string> {
  const res = await fetch(`${HTTP_BASE}/v1/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`signin ${res.status}: ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function api(token: string, method: string, path_: string, body?: unknown): Promise<Response> {
  return await fetch(`${HTTP_BASE}${path_}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ensureDatabase(token: string) {
  if (RESET) {
    const r = await api(token, "DELETE", `/v1/databases/${encodeURIComponent(DATABASE)}`);
    console.log(`  drop   ${DATABASE} -> ${r.status}`);
  }
  const list = await api(token, "GET", "/v1/databases");
  const body = (await list.json()) as { databases: Array<{ name: string }> };
  const names = (body.databases ?? []).map((d) => d.name);
  if (!names.includes(DATABASE)) {
    const r = await api(token, "POST", `/v1/databases/${encodeURIComponent(DATABASE)}`);
    if (!r.ok) throw new Error(`create db ${r.status}: ${await r.text()}`);
    console.log(`  create ${DATABASE}`);
  } else {
    console.log(`  exists ${DATABASE}`);
  }
}

async function runQuery(
  token: string,
  tql: string,
  mode: "read" | "write" | "schema" = "write",
) {
  const res = await api(token, "POST", `/v1/query`, {
    databaseName: DATABASE,
    query: tql,
    transactionType: mode,
    commit: mode !== "read",
  });
  if (!res.ok) {
    throw new Error(`${mode} query failed (${res.status}): ${await res.text()}\n— first 200 chars of query —\n${tql.slice(0, 200)}`);
  }
  return await res.json();
}

// Split the generator's insert.tql into independent blocks. Blocks are
// terminated by a `;\n\n` fence; comment lines and blanks between blocks
// are skipped.
function splitBlocks(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const blocks: string[] = [];
  let cur: string[] = [];
  for (const ln of lines) {
    if (cur.length === 0 && (ln.trim().startsWith("#") || ln.trim() === "")) continue;
    cur.push(ln);
    if (ln.trim() === "") {
      const block = cur.join("\n").trim();
      if (block) blocks.push(block);
      cur = [];
    }
  }
  if (cur.some((l) => l.trim())) {
    const block = cur.join("\n").trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

async function main() {
  console.log(`[load] HTTP=${HTTP_BASE}  DB=${DATABASE}  reset=${RESET}`);
  const token = await signin();
  await ensureDatabase(token);

  // 1. Schema
  const schemaPath = path.resolve("schema.tql");
  const schema = await readFile(schemaPath, "utf8");
  console.log(`[load] applying schema (${schema.length} bytes)`);
  await runQuery(token, schema, "schema");

  // 2. Data
  const insertPath = path.resolve("out/insert.tql");
  const insert = await readFile(insertPath, "utf8");
  const blocks = splitBlocks(insert);
  console.log(`[load] inserting ${blocks.length} blocks from ${insertPath} (batch=${BATCH})`);

  // TypeDB 3.x /v1/query executes ONLY the first statement per request — so
  // we must send one block at a time. We pipeline via Promise.all in small
  // rounds to claw back some throughput on localhost.
  let ok = 0, fail = 0;
  const CONCURRENCY = Number(process.env.CONCURRENCY ?? "8");
  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const slice = blocks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((b) => runQuery(token, b, "write")));
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === "fulfilled") ok++;
      else {
        fail++;
        if (fail < 10) console.error(`\n  SKIP block #${i + j}: ${String(r.reason).slice(0, 180)}`);
      }
    }
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, blocks.length)}/${blocks.length}  ok=${ok}  fail=${fail}`);
  }
  console.log(`\n[load] done  ok=${ok}  fail=${fail}`);
}

await main();
