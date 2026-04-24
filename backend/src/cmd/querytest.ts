// Query-test harness — runs four TypeQL query categories against TypeDB 3.x
// via its HTTP API and reports PASS/FAIL per assertion.
//
// Run after:
//   bash scripts/typedb-up.sh
//   bun run src/cmd/mockgen.ts
//   bun run src/cmd/load.ts        (or: bash scripts/typedb-load.sh)
//
//   bun run src/cmd/querytest.ts

import { ping, runReadQuery } from "../typedb/client.ts";

interface Test {
  name: string;
  category: "time-range" | "entity-touch" | "cross-boundary" | "4-layer";
  tql: string;
  expect: "nonZero" | { min: number } | { max: number } | { equal: number };
}

const tests: Test[] = [
  {
    name: "time-range: first 5 minute buckets return >0 episodes",
    category: "time-range",
    tql: `match
  $e isa episode, has minute_bucket $m;
  $m >= 29614170; $m < 29614175;
select $e, $m;`,
    expect: "nonZero",
  },
  {
    name: "entity-touch: player P1 is actor of >= 900 episodes",
    category: "entity-touch",
    tql: `match
  $p isa player, has player_id "P1";
  $e isa episode, links (actor: $p);
select $e;`,
    expect: { min: 900 },
  },
  {
    name: "entity-touch: >=1 episode has NPC N2 as counterpart",
    category: "entity-touch",
    tql: `match
  $n isa npc, has npc_id "N2";
  $e isa episode, links (counterpart: $n);
select $e;`,
    expect: "nonZero",
  },
  {
    name: "cross-boundary: crosses_minute=true returns >= 50",
    category: "cross-boundary",
    tql: `match $e isa episode, has crosses_minute true; select $e;`,
    expect: { min: 50 },
  },
  {
    name: "cross-boundary: crosses_hour=true returns >= 5",
    category: "cross-boundary",
    tql: `match $e isa episode, has crosses_hour true; select $e;`,
    expect: { min: 5 },
  },
  {
    name: "4-layer: importance>=0.7 AND activity_type='combat'",
    category: "4-layer",
    tql: `match
  $e isa episode, has importance $i, has activity_type "combat";
  $i >= 0.7;
select $e, $i;`,
    expect: "nonZero",
  },
  {
    name: "4-layer: community_id contains 'c_quest_' AND actor=P1",
    category: "4-layer",
    tql: `match
  $p isa player, has player_id "P1";
  $e isa episode, links (actor: $p), has community_id $c;
  $c contains "c_quest_";
select $e, $c;`,
    expect: "nonZero",
  },
];

type Verdict = { test: Test; pass: boolean; answers: number; note: string };

function checkExpect(actual: number, exp: Test["expect"]): { pass: boolean; note: string } {
  if (exp === "nonZero") return { pass: actual > 0, note: `expected >0, got ${actual}` };
  if ("min" in exp) return { pass: actual >= exp.min, note: `expected >=${exp.min}, got ${actual}` };
  if ("max" in exp) return { pass: actual <= exp.max, note: `expected <=${exp.max}, got ${actual}` };
  return { pass: actual === exp.equal, note: `expected ==${exp.equal}, got ${actual}` };
}

async function main() {
  console.log("n_ary_test — TypeDB query test harness");
  console.log("=======================================");

  if (!(await ping())) {
    console.error("!! TypeDB HTTP API not reachable on", process.env.TYPEDB_HTTP ?? "http://localhost:28000");
    console.error("   start with: bash scripts/typedb-up.sh");
    console.error("   load with : bash scripts/typedb-load.sh  (or: bun run src/cmd/load.ts)");
    process.exit(2);
  }

  const verdicts: Verdict[] = [];
  for (const t of tests) {
    process.stdout.write(`[ .. ] ${t.category.padEnd(15)} ${t.name} ... `);
    const r = await runReadQuery(t.tql);
    if (!r.ok) {
      console.log("ERROR");
      console.log(r.error ?? "");
      verdicts.push({ test: t, pass: false, answers: 0, note: "query failed" });
      continue;
    }
    const { pass, note } = checkExpect(r.answers, t.expect);
    console.log(pass ? "PASS" : "FAIL", `(${note})`);
    verdicts.push({ test: t, pass, answers: r.answers, note });
  }

  const passed = verdicts.filter((v) => v.pass).length;
  console.log("");
  console.log("=======================================");
  console.log(`Results: ${passed}/${verdicts.length} passed`);
  const byCat: Record<string, { pass: number; total: number }> = {};
  for (const v of verdicts) {
    byCat[v.test.category] ??= { pass: 0, total: 0 };
    byCat[v.test.category]!.total++;
    if (v.pass) byCat[v.test.category]!.pass++;
  }
  for (const [cat, s] of Object.entries(byCat)) {
    console.log(`  ${cat.padEnd(16)} ${s.pass}/${s.total}`);
  }
  process.exit(passed === verdicts.length ? 0 : 1);
}

await main();
