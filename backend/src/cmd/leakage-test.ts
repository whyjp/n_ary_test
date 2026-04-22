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
    console.log(`\n[${c.kind}] ${c.title}`);
    console.log(`  ${c.note}`);
    console.log(`    hyperedge  : ${c.hyper.count}${c.hyper.error ? "  ERR: " + c.hyper.error : ""}`);
    console.log(`    triplet    : ${c.triplet.count}${c.triplet.error ? "  ERR: " + c.triplet.error : ""}`);
    console.log(`    ratio      : ${c.ratio}x`);
    if (c.verdict) {
      console.log(`    score      : ${c.verdict.score}/100  (${c.verdict.kind}, judge=${c.verdict.judge})`);
      console.log(`    verdict    : ${c.verdict.rule_verdict}`);
      if (c.verdict.llm_verdict) console.log(`    llm-reason : ${c.verdict.llm_verdict}`);
    }
    if (c.phantom) console.log(`    ⚠ phantom  : triplet returns ${c.triplet.count} cross-episode combinations that never co-occurred`);
  }

  console.log("\n" + "=".repeat(78));
  console.log(`judge     : ${r.judge}`);
  console.log(`totals    : hyperedge=${r.total_hyper}  triplet=${r.total_triplet}  phantom=${r.total_phantom}`);
  console.log(`avg score : ${r.avg_score}/100 (higher = better triplet precision vs hyperedge ground truth)`);
  falkorClose();
}

await main();
export {};
