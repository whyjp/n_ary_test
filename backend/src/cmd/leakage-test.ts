// Cross-episode leakage test — the core thesis demonstration.
//
// Same semantic questions are run against two structurally different graphs
// that hold the *same underlying events*:
//
//   (a) TypeDB 3.x `n_ary`    — n-ary episode relation; each event is a
//                                single hyperedge with episode-exact context.
//   (b) FalkorDB `n_ary_triplet` — industry-standard property graph; every
//                                 event is decomposed into binary triplets
//                                 without episode identity.
//
// Query per case is semantically equivalent:
//   - Hyperedge: matches inside ONE `episode` relation (single-event).
//   - Triplet: joins several binary edges — traversal freely recombines
//              edges from different episodes, producing false-positive
//              "phantom" paths.
//
// Run after:
//   bash scripts/typedb-up.sh
//   bun run src/cmd/mockgen.ts
//   bun run src/cmd/load.ts --reset
//   bun run src/cmd/load-falkor.ts --reset
//
//   bun run src/cmd/leakage-test.ts

import { ping as falkorPing, graphQuery, close as falkorClose, answerCount } from "../falkor/client.ts";

const TYPEDB_HTTP = process.env.TYPEDB_HTTP ?? "http://localhost:8000";
const TYPEDB_DB   = process.env.TYPEDB_DATABASE ?? "n_ary";
const TYPEDB_USER = process.env.TYPEDB_USER ?? "admin";
const TYPEDB_PASS = process.env.TYPEDB_PASSWORD ?? "password";
const FALKOR_GRAPH = process.env.FALKOR_GRAPH ?? "n_ary_triplet";

async function typedbToken(): Promise<string> {
  const r = await fetch(`${TYPEDB_HTTP}/v1/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TYPEDB_USER, password: TYPEDB_PASS }),
  });
  if (!r.ok) throw new Error(`typedb signin ${r.status}`);
  return ((await r.json()) as any).token;
}

async function typedbCount(token: string, tql: string): Promise<{ count: number; err?: string }> {
  const r = await fetch(`${TYPEDB_HTTP}/v1/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ databaseName: TYPEDB_DB, query: tql, transactionType: "read", commit: false }),
  });
  if (!r.ok) return { count: 0, err: `${r.status} ${(await r.text()).slice(0, 100)}` };
  const body = (await r.json()) as { answers: any[] | null };
  return { count: (body.answers ?? []).length };
}

async function falkorCount(cypher: string): Promise<{ count: number; err?: string }> {
  try {
    const res = await graphQuery(FALKOR_GRAPH, cypher);
    return { count: answerCount(res) };
  } catch (e) {
    return { count: 0, err: String(e).slice(0, 120) };
  }
}

interface Case {
  title: string;
  note: string;
  hyper: string;   // TypeQL against n_ary
  triplet: string; // Cypher against FalkorDB
}

const cases: Case[] = [
  {
    title: "Case 1 · P1 used item 금화(I4) at location 던전1(L3)?",
    note:  "Hyperedge forces item, actor, location into ONE episode. Cypher joins three independent edges — player→I4, I4→L3, player→L3 — any of which could come from a different episode.",
    hyper: `match
  $p isa player,   has player_id "P1";
  $i isa item,     has item_id   "I4";
  $l isa location, has location_id "L3";
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l);
select $e;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:USED_ITEM]->(i:Item {id:"I4"}),
             (i)-[:ITEM_AT_LOCATION]->(l:Location {id:"L3"}),
             (p)-[:PLAYER_AT_LOCATION]->(l)
       RETURN p, i, l`,
  },
  {
    title: "Case 2 · P1 killed mob 드래곤새끼(M7) while NPC 퀘스트주인(N2) was a counterpart?",
    note:  "The generator never binds counterpart+mob_target in the same episode. Hyperedge correctly returns 0. Cypher returns cartesian phantoms.",
    hyper: `match
  $p isa player,  has player_id "P1";
  $m isa mob,     has mob_id "M7";
  $n isa npc,     has npc_id "N2";
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n);
select $e;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:PLAYER_KILLED_MOB]->(m:Mob {id:"M7"}),
             (p)-[:PLAYER_WITH_COUNTERPART]->(n:NPC {id:"N2"})
       RETURN p, m, n`,
  },
  {
    title: "Case 3 · Locations where item 보석(I5) co-occurred with NPC 상인(N1)?",
    note:  "Hyperedge yields locations with BOTH in one episode. Cypher returns L(I5) ∩ L(N1) — every location where either appeared on its own.",
    hyper: `match
  $i isa item, has item_id "I5";
  $n isa npc,  has npc_id  "N1";
  $l isa location;
  $e isa episode, links (item_payload: $i, counterpart: $n, at_location: $l);
select $l;`,
    triplet: `MATCH (i:Item {id:"I5"})-[:ITEM_AT_LOCATION]->(l:Location),
             (n:NPC {id:"N1"})-[:COUNTERPART_AT_LOCATION]->(l)
       RETURN DISTINCT l`,
  },
  {
    title: "Case 4 · Duels in dungeon (L3 or L4) with BOTH N4 and N6 as counterparts?",
    note:  "A duel in the generator has exactly one counterpart. Hyperedge returns 0. Cypher freely joins two separate PLAYER_WITH_COUNTERPART edges — any dungeon episode suffices.",
    hyper: `match
  $p isa player, has player_id "P1";
  $n1 isa npc, has npc_id "N4";
  $n2 isa npc, has npc_id "N6";
  $l isa location, has location_id $lid;
  { $lid == "L3"; } or { $lid == "L4"; };
  $e isa episode, links (actor: $p, counterpart: $n1, counterpart: $n2, at_location: $l), has relation_type "duel";
select $e;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:PLAYER_WITH_COUNTERPART]->(n1:NPC {id:"N4"}),
             (p)-[:PLAYER_WITH_COUNTERPART]->(n2:NPC {id:"N6"}),
             (p)-[:PLAYER_AT_LOCATION]->(l:Location)
       WHERE l.id IN ["L3","L4"]
       RETURN p, n1, n2, l`,
  },
];

async function main() {
  console.log("cross-episode leakage test · hyperedge vs pair-wise triplet");
  console.log("=".repeat(78));

  if (!(await falkorPing())) {
    console.error("!! FalkorDB not reachable — load-falkor.ts must have been run.");
    process.exit(2);
  }
  const tok = await typedbToken();

  let tHyper = 0, tTriplet = 0, phantom = 0;
  for (const c of cases) {
    console.log(`\n${c.title}`);
    console.log(`  ${c.note}`);
    const h = await typedbCount(tok, c.hyper);
    const f = await falkorCount(c.triplet);
    tHyper += h.count; tTriplet += f.count;
    const ratio = h.count === 0 ? (f.count === 0 ? "—" : "∞") : (f.count / h.count).toFixed(2);
    console.log(`    hyperedge  (TypeDB n_ary)             answers: ${h.count}${h.err ? "  ERR: " + h.err : ""}`);
    console.log(`    triplet    (FalkorDB n_ary_triplet)   answers: ${f.count}${f.err ? "  ERR: " + f.err : ""}`);
    console.log(`    leakage ratio (triplet / hyperedge)   : ${ratio}x`);
    if (h.count === 0 && f.count > 0) {
      phantom += f.count;
      console.log(`    ⚠ phantom paths: triplet reports ${f.count} combinations that never actually co-occurred in a single event`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(`totals:  hyperedge=${tHyper}   triplet=${tTriplet}   phantom(false-positive)=${phantom}`);
  console.log(`conclusion: n-ary relation preserves episode boundary by construction.`);
  console.log(`            pair-wise triplet graph requires per-edge episode tagging + join`);
  console.log(`            to avoid ${phantom} cross-episode leak combinations — which is the`);
  console.log(`            exact storage/performance cost hyperedge modelling is designed`);
  console.log(`            to avoid.`);
  falkorClose();
}

await main();

export {};
