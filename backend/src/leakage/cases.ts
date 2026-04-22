// Leakage test cases for the TypeDB n-ary hyperedge schema vs the FalkorDB
// reified triplet schema.
//
// Both databases hold the SAME events:
//   - TypeDB: each event is one `episode` relation instance (n-ary).
//   - FalkorDB: each event is one `Episode` node with `:ROLE` edges out
//     to the entity nodes. Data parity: 37 entities + 999 Episode nodes in
//     both DBs (+ ~3,553 role edges on the FalkorDB side).
//
// Each case pairs:
//   hyper   — TypeQL `$e isa episode, links (...)` — a SINGLE relation
//             variable binds every role in one event.
//   triplet — Cypher using separate `(:Episode)` clauses for each role
//             reference — i.e. the "naive" pattern a query author reaches
//             for when translating a multi-slot question to pair-wise
//             edges. Each anonymous `:Episode` can match a different
//             event, so edges from distinct events get freely recombined.
//
// A "proper" Cypher author would bind a single `e:Episode` variable and
// reuse it; that equivalent query eliminates the leak but gives up the
// schema-level guarantee. The thesis: n-ary relations make the correct
// behaviour the STRUCTURAL default — you cannot "forget" to bind roles
// to one event.

export interface LeakageCase {
  id: string;
  title: string;
  note: string;
  hyper: string;
  triplet: string;
  // Hub-scoped variant. Same naive pair-wise pattern, but every :Episode
  // reference is required to belong to the SAME (hour × player) hub. This
  // demonstrates the middle tier: context-scoped triplet — phantoms reduce
  // from "across all episodes" to "within one hub" but remain non-zero
  // because distinct :Episode nodes within the hub can still be freely
  // recombined (no per-event identity enforcement at the schema level).
  triplet_hub: string;
  kind: "co_occur" | "multi_hop" | "cardinality";
}

export const cases: LeakageCase[] = [
  {
    id: "c1-p1-used-i4-at-l3",
    kind: "cardinality",
    title: "Case 1 · P1이 I4(금화)를 L3(던전1)에서 사용",
    note:
      "Hyperedge는 item/actor/location을 단일 episode에 강제. Naive Cypher는 세 개의 분리된 :Episode 바인딩으로 묶어도 카디널리티가 폭발 — 실제 에피소드 수는 맞지만 다른 에피소드의 role이 결합되어 집계됨.",
    hyper: `match
  $p isa player,   has player_id "P1";
  $i isa item,     has item_id   "I4";
  $l isa location, has location_id "L3";
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I4"}),
             (:Episode)-[:AT_LOCATION]->(l:Location {id:"L3"})
       RETURN p, i, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I4"}),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location {id:"L3"})
       RETURN p, i, l
       LIMIT 2000`,
  },

  {
    id: "c2-kill-m7-with-n2",
    kind: "co_occur",
    title: "Case 2 · P1이 M7(드래곤새끼) 처치 시 N2(퀘스트주인)가 counterpart?",
    note:
      "생성기는 mob_target과 counterpart를 같은 episode에 바인딩하지 않음. Hyperedge는 구조적 0. Naive Cypher는 ACTOR, MOB_TARGET, COUNTERPART 세 역할을 세 개의 서로 다른 Episode 노드에서 매칭 — 다른 이벤트에서 결합한 phantom.",
    hyper: `match
  $p isa player,  has player_id "P1";
  $m isa mob,     has mob_id "M7";
  $n isa npc,     has npc_id "N2";
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
             (:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
       RETURN p, m, n
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
             (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
       RETURN p, m, n
       LIMIT 2000`,
  },

  {
    id: "c3-i5-with-n1-locations",
    kind: "co_occur",
    title: "Case 3 · I5(보석)와 N1(상인)의 공동 등장 위치",
    note:
      "Hyperedge: 한 episode 안에 두 역할이 같은 location에 함께 바인딩된 경우. Naive Cypher는 I5가 등장한 모든 episode의 location ∪ N1이 등장한 모든 episode의 location — 동일 위치에 둘 다 있었던 적이 없어도 결합됨.",
    hyper: `match
  $i isa item, has item_id "I5";
  $n isa npc,  has npc_id  "N1";
  $l isa location, has location_id $lid;
  $e isa episode, links (item_payload: $i, counterpart: $n, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I5"}),
             (:Episode)-[:AT_LOCATION]->(l:Location),
             (:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
             (:Episode)-[:AT_LOCATION]->(l)
       RETURN DISTINCT l
       LIMIT 500`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I5"}),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
             (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l)
       RETURN DISTINCT l
       LIMIT 500`,
  },

  {
    id: "c4-duel-n4-n6-dungeon",
    kind: "co_occur",
    title: "Case 4 · L3/L4 던전에서 N4와 N6 모두를 counterpart로 하는 듀얼",
    note:
      "duel 에피소드의 counterpart는 1명. Hyperedge는 0. Naive Cypher는 두 COUNTERPART 엣지를 서로 다른 Episode에서 매칭해서 '듀얼에 N4도 N6도 있었다'는 가짜 경로를 만듦.",
    hyper: `match
  $p isa player, has player_id "P1";
  $n1 isa npc, has npc_id "N4";
  $n2 isa npc, has npc_id "N6";
  $l isa location, has location_id $lid;
  { $lid == "L3"; } or { $lid == "L4"; };
  $e isa episode, links (actor: $p, counterpart: $n1, counterpart: $n2, at_location: $l),
    has relation_type "duel", has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n1:NPC {id:"N4"}),
             (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n2:NPC {id:"N6"}),
             (:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location)
       WHERE l.id IN ["L3","L4"]
       RETURN p, n1, n2, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n1:NPC {id:"N4"}),
             (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n2:NPC {id:"N6"}),
             (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location)
       WHERE l.id IN ["L3","L4"]
       RETURN p, n1, n2, l
       LIMIT 2000`,
  },

  {
    id: "c5-multihop-p1-items-reach-locations",
    kind: "multi_hop",
    title: "Case 5 · P1이 사용한 아이템을 거쳐 '도달한' location (2-hop reach)",
    note:
      "Hyperedge: 같은 episode 안에 P1·item·location이 바인딩된 경우. Naive Cypher: P1이 쓴 item의 location 집합 — 이후 다른 episode에서 item이 나타난 location까지 포함.",
    hyper: `match
  $p isa player, has player_id "P1";
  $i isa item;
  $l isa location;
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode)-[:ITEM_PAYLOAD]->(i:Item),
             (:Episode)-[:ITEM_PAYLOAD]->(i),
             (:Episode)-[:AT_LOCATION]->(l:Location)
       RETURN DISTINCT p, i, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item),
             (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location)
       RETURN DISTINCT p, i, l
       LIMIT 2000`,
  },

  {
    id: "c6-multihop-npc-mob-colocation",
    kind: "multi_hop",
    title: "Case 6 · N1(상인)과 같은 location에 있던 Mob을 P1이 처치 (3-hop)",
    note:
      "한 episode 안에서의 co-presence 질문. Naive Cypher는 N1의 location, Mob의 location, P1의 kill을 세 개 Episode에서 매칭해서 결합.",
    hyper: `match
  $p isa player, has player_id "P1";
  $n isa npc, has npc_id "N1";
  $m isa mob;
  $l isa location;
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
             (:Episode)-[:AT_LOCATION]->(l:Location),
             (:Episode)-[:MOB_TARGET]->(m:Mob),
             (:Episode)-[:AT_LOCATION]->(l),
             (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode)-[:MOB_TARGET]->(m)
       RETURN DISTINCT p, n, m, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
             (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l),
             (h)-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m)
       RETURN DISTINCT p, n, m, l
       LIMIT 2000`,
  },

  {
    id: "c7-multihop-item-mob-at-location",
    kind: "multi_hop",
    title: "Case 7 · P1이 사용한 아이템과 처치한 몹이 같은 location인 경우",
    note:
      "세 서브조건이 같은 episode 안에 있어야 의미를 가진다. Naive Cypher는 location을 조인 키로 쓰지만 item/mob/actor 각각 다른 episode에서 와도 결합됨.",
    hyper: `match
  $p isa player, has player_id "P1";
  $i isa item;
  $m isa mob;
  $l isa location;
  $e isa episode, links (actor: $p, item_payload: $i, mob_target: $m, at_location: $l), has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode)-[:ITEM_PAYLOAD]->(i:Item),
             (:Episode)-[:AT_LOCATION]->(l:Location),
             (:Episode)-[:ITEM_PAYLOAD]->(i),
             (:Episode)-[:MOB_TARGET]->(m:Mob),
             (:Episode)-[:AT_LOCATION]->(l),
             (:Episode)-[:MOB_TARGET]->(m)
       RETURN DISTINCT p, i, m, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
             (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i),
             (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l),
             (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m)
       RETURN DISTINCT p, i, m, l
       LIMIT 2000`,
  },

  {
    id: "c8-multihop-duel-device-location",
    kind: "multi_hop",
    title: "Case 8 · duel 에피소드에서 사용된 device까지의 multi-hop",
    note:
      "duel은 via_device 역할을 바인딩하지 않는다. Hyperedge=0. Naive Cypher는 duel Episode의 role과 login/logout Episode의 device role을 location 공유로 결합.",
    hyper: `match
  $p isa player, has player_id "P1";
  $n isa npc;
  $d isa device;
  $l isa location;
  $e isa episode, links (actor: $p, counterpart: $n, via_device: $d, at_location: $l),
    has relation_type "duel", has ns_id $ns;
select $ns;`,
    triplet: `MATCH (:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
             (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n:NPC),
             (:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location),
             (:Episode)-[:VIA_DEVICE]->(d:Device),
             (:Episode)-[:AT_LOCATION]->(l)
       RETURN DISTINCT p, n, d, l
       LIMIT 2000`,
    triplet_hub: `MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
             (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n:NPC),
             (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location),
             (h)-[:CONTAINS]->(:Episode)-[:VIA_DEVICE]->(d:Device),
             (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l)
       RETURN DISTINCT p, n, d, l
       LIMIT 2000`,
  },
];
