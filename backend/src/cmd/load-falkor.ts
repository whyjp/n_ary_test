// Load the same dataset into FalkorDB as plain property-graph triplets.
// Uses the minimal Bun TCP+RESP client under src/falkor/client.ts.
//
//   bun run backend/src/cmd/load-falkor.ts
//   bun run backend/src/cmd/load-falkor.ts --reset

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Dataset } from "../domain/types.ts";
import { buildCypher } from "../falkor/generator.ts";
import { close, graphDelete, graphQuery, ping } from "../falkor/client.ts";

const GRAPH = process.env.FALKOR_GRAPH ?? "n_ary_triplet";
const RESET = Bun.argv.includes("--reset");
const BATCH = Number(process.env.FALKOR_BATCH ?? "100");

async function main() {
  if (!(await ping())) {
    console.error("!! FalkorDB not reachable on", process.env.FALKOR_HOST ?? "localhost:6379");
    console.error("   start with: bash scripts/typedb-up.sh (also starts FalkorDB)");
    process.exit(2);
  }
  const episodesPath = path.resolve("out/episodes.json");
  const ds = JSON.parse(await readFile(episodesPath, "utf8")) as Dataset;
  console.log(`[falkor] source: ${ds.episodes.length} episodes`);

  if (RESET) {
    await graphDelete(GRAPH);
    console.log(`[falkor] dropped ${GRAPH}`);
  }

  const { nodeQueries, edgeQueries, stats } = buildCypher(ds);
  console.log(`[falkor] nodes=${stats.nodes}  unique-edges=${stats.uniqueEdges}  hubs=${stats.hubs}  contains=${stats.containsEdges}`);
  for (const [rel, n] of Object.entries(stats.byRelation)) {
    console.log(`          ${rel.padEnd(26)} ${n}`);
  }
  console.log(`          ${"CONTAINS".padEnd(26)} ${stats.containsEdges}`);

  // Push in batches — multiple statements are allowed per GRAPH.QUERY when
  // joined with a semicolon; but FalkorDB prefers one statement per call so
  // we just iterate.
  console.log(`[falkor] loading nodes...`);
  for (let i = 0; i < nodeQueries.length; i += BATCH) {
    const slice = nodeQueries.slice(i, i + BATCH);
    await Promise.all(slice.map((q) => graphQuery(GRAPH, q)));
    process.stdout.write(`\r  nodes ${Math.min(i + BATCH, nodeQueries.length)}/${nodeQueries.length}`);
  }
  console.log("");

  console.log(`[falkor] loading edges...`);
  let ok = 0, fail = 0;
  for (let i = 0; i < edgeQueries.length; i += BATCH) {
    const slice = edgeQueries.slice(i, i + BATCH);
    const res = await Promise.allSettled(slice.map((q) => graphQuery(GRAPH, q)));
    for (const r of res) {
      if (r.status === "fulfilled") ok++;
      else { fail++; if (fail < 5) console.error(`\n  SKIP: ${String(r.reason).slice(0, 120)}`); }
    }
    process.stdout.write(`\r  edges ${Math.min(i + BATCH, edgeQueries.length)}/${edgeQueries.length}  ok=${ok}  fail=${fail}`);
  }
  console.log(`\n[falkor] done`);
  close();
}

await main();
