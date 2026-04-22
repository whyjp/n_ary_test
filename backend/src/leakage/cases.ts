// Canonical leakage test cases, shared between:
//   - cmd/leakage-test.ts (CLI output)
//   - cmd/server.ts  via /api/leakage/run (web panel)
//
// Each case pairs a TypeQL match (n-ary hyperedge) with a Cypher match
// (pair-wise triplet). The TypeQL side additionally exposes ns_id so the
// web viz can highlight matching episodes in the 3D scene.

export interface LeakageCase {
  id: string;
  title: string;
  note: string;
  hyper: string;    // TypeQL — selects $ns
  triplet: string;  // Cypher — returns id columns
}

export const cases: LeakageCase[] = [
  {
    id: "c1-p1-used-i4-at-l3",
    title: "Case 1 · P1이 I4(금화)를 L3(던전1)에서 사용",
    note:
      "Hyperedge는 item·actor·location을 단일 에피소드 안에 강제. Triplet은 세 개의 독립 엣지(player→I4, I4→L3, player→L3)를 조인 — 각각 다른 에피소드에서 왔을 수 있어 cardinality가 1로 dedupe되며 의미가 희석된다.",
    hyper: `match
  $p isa player,   has player_id "P1";
  $i isa item,     has item_id   "I4";
  $l isa location, has location_id "L3";
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:USED_ITEM]->(i:Item {id:"I4"}),
             (i)-[:ITEM_AT_LOCATION]->(l:Location {id:"L3"}),
             (p)-[:PLAYER_AT_LOCATION]->(l)
       RETURN p, i, l`,
  },
  {
    id: "c2-kill-m7-with-n2",
    title: "Case 2 · P1이 M7(드래곤새끼) 처치 시 N2(퀘스트주인)가 counterpart?",
    note:
      "생성기는 counterpart와 mob_target을 같은 에피소드에 바인딩하지 않음. Hyperedge는 구조적으로 0을 반환. Triplet은 player→M7 엣지와 player→N2 엣지를 자유롭게 결합 → phantom.",
    hyper: `match
  $p isa player,  has player_id "P1";
  $m isa mob,     has mob_id "M7";
  $n isa npc,     has npc_id "N2";
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:PLAYER_KILLED_MOB]->(m:Mob {id:"M7"}),
             (p)-[:PLAYER_WITH_COUNTERPART]->(n:NPC {id:"N2"})
       RETURN p, m, n`,
  },
  {
    id: "c3-i5-with-n1-locations",
    title: "Case 3 · I5(보석)와 N1(상인)의 공동 등장 위치",
    note:
      "Hyperedge: 한 에피소드 안에 두 역할이 같은 location에 바인딩된 경우만. Triplet: L(I5) ∩ L(N1) — 각자 따로 나타났던 모든 위치 집합의 교집합까지 포함.",
    hyper: `match
  $i isa item, has item_id "I5";
  $n isa npc,  has npc_id  "N1";
  $l isa location, has location_id $lid;
  $e isa episode, links (item_payload: $i, counterpart: $n, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (i:Item {id:"I5"})-[:ITEM_AT_LOCATION]->(l:Location),
             (n:NPC {id:"N1"})-[:COUNTERPART_AT_LOCATION]->(l)
       RETURN DISTINCT l`,
  },
  {
    id: "c4-duel-n4-n6-dungeon",
    title: "Case 4 · L3/L4 던전에서 N4와 N6 모두를 counterpart로 하는 듀얼",
    note:
      "생성기의 duel 에피소드는 counterpart 1명만. Hyperedge는 0을 반환. Triplet은 두 개의 player→counterpart 엣지가 별개 에피소드에서 왔어도 자유 결합 → phantom.",
    hyper: `match
  $p isa player, has player_id "P1";
  $n1 isa npc, has npc_id "N4";
  $n2 isa npc, has npc_id "N6";
  $l isa location, has location_id $lid;
  { $lid == "L3"; } or { $lid == "L4"; };
  $e isa episode, links (actor: $p, counterpart: $n1, counterpart: $n2, at_location: $l),
    has relation_type "duel", has ns_id $ns;
select $ns;`,
    triplet: `MATCH (p:Player {id:"P1"})-[:PLAYER_WITH_COUNTERPART]->(n1:NPC {id:"N4"}),
             (p)-[:PLAYER_WITH_COUNTERPART]->(n2:NPC {id:"N6"}),
             (p)-[:PLAYER_AT_LOCATION]->(l:Location)
       WHERE l.id IN ["L3","L4"]
       RETURN p, n1, n2, l`,
  },
];
