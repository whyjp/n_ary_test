// Cross-episode leakage test — CLI output.
// Thin wrapper around leakage/runner.ts so the CLI and the /api/leakage/run
// REST endpoint share the exact same cases + execution path.
//
//   bun run src/cmd/leakage-test.ts

import { runLeakage } from "../leakage/runner.ts";
import { close as falkorClose } from "../falkor/client.ts";

async function main() {
  console.log("cross-episode leakage test · hyperedge vs pair-wise triplet");
  console.log("=".repeat(78));

  const r = await runLeakage();
  if (!r.typedb_available) {
    console.error("!! TypeDB not reachable — bash scripts/typedb-up.sh"); process.exit(2);
  }
  if (!r.falkor_available) {
    console.error("!! FalkorDB not reachable — bash scripts/typedb-up.sh"); process.exit(2);
  }

  for (const c of r.cases) {
    console.log(`\n${c.title}`);
    console.log(`  ${c.note}`);
    console.log(`    hyperedge (TypeDB n_ary)           answers: ${c.hyper.count}${c.hyper.error ? "  ERR: " + c.hyper.error : ""}`);
    console.log(`    triplet   (FalkorDB n_ary_triplet) answers: ${c.triplet.count}${c.triplet.error ? "  ERR: " + c.triplet.error : ""}`);
    console.log(`    leakage ratio                     : ${c.ratio}x`);
    if (c.phantom) console.log(`    ⚠ phantom paths: triplet reports ${c.triplet.count} combinations that never actually co-occurred in a single event`);
  }

  console.log("\n" + "=".repeat(78));
  console.log(`totals  hyperedge=${r.total_hyper}  triplet=${r.total_triplet}  phantom=${r.total_phantom}`);
  falkorClose();
}

await main();
export {};
