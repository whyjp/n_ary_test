# Leakage 케이스 8개 — 티어별 쿼리 카탈로그

각 케이스는 세 가지 쿼리로 동시에 측정된다:
- **n-ary (TypeQL)** — TypeDB의 `episode` relation 바인딩 (ground truth)
- **triplet_naive (Cypher)** — FalkorDB의 raw pair-wise traversal
- **triplet_hub (Cypher)** — `(h:TimePlayerHub)-[:CONTAINS]->` 스코프 강제

허브 티어가 얼마나 phantom을 줄이는지는 FE의 `hub ↓NN%` 칩으로 확인 가능.

소스: `backend/src/leakage/cases.ts`

---

## Case 1 · `cardinality` — P1이 I4(금화)를 L3(던전1)에서 사용

한 에피소드 안에 actor + item + location 삼중 바인딩 수.

**n-ary**
```tql
match
  $p isa player,   has player_id "P1";
  $i isa item,     has item_id   "I4";
  $l isa location, has location_id "L3";
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l), has ns_id $ns;
select $ns;
```

**triplet_naive**
```cypher
MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I4"}),
      (:Episode)-[:AT_LOCATION]->(l:Location {id:"L3"})
RETURN p, i, l LIMIT 2000
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I4"}),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location {id:"L3"})
RETURN p, i, l LIMIT 2000
```

N-ary 답: 14 events. Naive: 2000 (LIMIT). Hub: 분당 공동 바인딩만 — 대폭 감소.

---

## Case 2 · `co_occur` — P1이 M7(드래곤새끼) 처치 시 N2(퀘스트주인)가 counterpart?

생성기가 이 삼중 바인딩을 만들지 않도록 설계됨 → **n-ary는 구조적 0**.

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $m isa mob,    has mob_id "M7";
  $n isa npc,    has npc_id "N2";
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n), has ns_id $ns;
select $ns;
```

**triplet_naive**
```cypher
MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
      (:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
RETURN p, m, n LIMIT 2000
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
      (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
RETURN p, m, n LIMIT 2000
```

N-ary=**0**, naive=2000 (100% phantom), hub=0~수십 (같은 분 안 재조합만 가능).

---

## Case 3 · `co_occur` — I5(보석)와 N1(상인)의 공동 등장 위치

한 에피소드 안에서 아이템·NPC가 같은 location에 바인딩된 적이 있는가.

**n-ary**
```tql
match
  $i isa item, has item_id "I5";
  $n isa npc,  has npc_id  "N1";
  $l isa location, has location_id $lid;
  $e isa episode, links (item_payload: $i, counterpart: $n, at_location: $l), has ns_id $ns;
select $ns;
```

**triplet_naive** — `l`을 조인 키로 재사용 (shared-entity phantom 유발)
```cypher
MATCH (:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I5"}),
      (:Episode)-[:AT_LOCATION]->(l:Location),
      (:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
      (:Episode)-[:AT_LOCATION]->(l)
RETURN DISTINCT l LIMIT 500
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item {id:"I5"}),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
      (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l)
RETURN DISTINCT l LIMIT 500
```

**주의**: Hub 변형도 `l`을 공유 조인 키로 사용. 같은 허브 안 서로 다른 에피소드의
location 일치는 여전히 phantom을 만들 수 있다 → `hub-limitations.md` §1 참고.

---

## Case 4 · `co_occur` — duel(L3/L4)에 N4, N6 모두

duel 에피소드의 counterpart 수는 1 → **n-ary는 구조적 0**.

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $n1 isa npc, has npc_id "N4";
  $n2 isa npc, has npc_id "N6";
  $l isa location, has location_id $lid;
  { $lid == "L3"; } or { $lid == "L4"; };
  $e isa episode, links (actor: $p, counterpart: $n1, counterpart: $n2, at_location: $l),
    has relation_type "duel", has ns_id $ns;
select $ns;
```

**triplet_naive**
```cypher
MATCH (:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n1:NPC {id:"N4"}),
      (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n2:NPC {id:"N6"}),
      (:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location)
WHERE l.id IN ["L3","L4"]
RETURN p, n1, n2, l LIMIT 2000
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n1:NPC {id:"N4"}),
      (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n2:NPC {id:"N6"}),
      (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location)
WHERE l.id IN ["L3","L4"]
RETURN p, n1, n2, l LIMIT 2000
```

N-ary=0, naive=2000, hub≈0 (보통 한 분 안에 duel이 여러 개 동시 발생하지 않음).

---

## Case 5 · `multi_hop` — P1이 사용한 item을 거쳐 도달한 location (2-hop)

3-slot co-bindings within episode; `i`가 조인 키.

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $i isa item;
  $l isa location;
  $e isa episode, links (actor: $p, item_payload: $i, at_location: $l), has ns_id $ns;
select $ns;
```

**triplet_naive** — timeout
```cypher
MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:ITEM_PAYLOAD]->(i:Item),
      (:Episode)-[:ITEM_PAYLOAD]->(i),
      (:Episode)-[:AT_LOCATION]->(l:Location)
RETURN DISTINCT p, i, l LIMIT 2000
```

**triplet_hub** — 허브 스코프로 TIMEOUT 해제
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item),
      (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location)
RETURN DISTINCT p, i, l LIMIT 2000
```

N-ary=777 (실제 P1의 item×location 쌍), naive=TIMEOUT, hub 실행됨.

---

## Case 6 · `multi_hop` — N1·mob·location 공동 현장 (3-hop)

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $n isa npc, has npc_id "N1";
  $m isa mob;
  $l isa location;
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n, at_location: $l), has ns_id $ns;
select $ns;
```

**triplet_naive** (6-way join, timeout)
```cypher
MATCH (:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
      (:Episode)-[:AT_LOCATION]->(l:Location),
      (:Episode)-[:MOB_TARGET]->(m:Mob),
      (:Episode)-[:AT_LOCATION]->(l),
      (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:MOB_TARGET]->(m)
RETURN DISTINCT p, n, m, l LIMIT 2000
```

**triplet_hub** — 6-way도 허브 안에선 완료 가능
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N1"}),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l),
      (h)-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m)
RETURN DISTINCT p, n, m, l LIMIT 2000
```

N-ary=0 (N1+mob+location 삼중 바인딩된 에피소드 없음), naive=TIMEOUT, hub=소수.

---

## Case 7 · `multi_hop` — P1이 사용한 아이템과 처치한 몹이 같은 location

7-way join, shared `i`, `m`, `l`.

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $i isa item;
  $m isa mob;
  $l isa location;
  $e isa episode, links (actor: $p, item_payload: $i, mob_target: $m, at_location: $l), has ns_id $ns;
select $ns;
```

**triplet_naive** (7-way, timeout)
```cypher
MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:ITEM_PAYLOAD]->(i:Item),
      (:Episode)-[:AT_LOCATION]->(l:Location),
      (:Episode)-[:ITEM_PAYLOAD]->(i),
      (:Episode)-[:MOB_TARGET]->(m:Mob),
      (:Episode)-[:AT_LOCATION]->(l),
      (:Episode)-[:MOB_TARGET]->(m)
RETURN DISTINCT p, i, m, l LIMIT 2000
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i:Item),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location),
      (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m)
RETURN DISTINCT p, i, m, l LIMIT 2000
```

N-ary=213, naive=TIMEOUT, hub: **within-hub phantom 잔존 가장 크다** — `l`, `i`,
`m`이 모두 조인 키로 재사용되어 허브 안의 서로 다른 에피소드가 다중 경로로
재조합 가능.

---

## Case 8 · `multi_hop` — duel 에피소드에 device (2-hop, cross-type)

duel의 `via_device`는 바인딩 안 됨 → **n-ary=0**.

**n-ary**
```tql
match
  $p isa player, has player_id "P1";
  $n isa npc;
  $d isa device;
  $l isa location;
  $e isa episode, links (actor: $p, counterpart: $n, via_device: $d, at_location: $l),
    has relation_type "duel", has ns_id $ns;
select $ns;
```

**triplet_naive** — duel Episode와 device Episode를 location `l`로 bridge
```cypher
MATCH (:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode {relation_type:"duel"})-[:COUNTERPART]->(n:NPC),
      (:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location),
      (:Episode)-[:VIA_DEVICE]->(d:Device),
      (:Episode)-[:AT_LOCATION]->(l)
RETURN DISTINCT p, n, d, l LIMIT 2000
```

**triplet_hub**
```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:COUNTERPART]->(n:NPC),
      (h)-[:CONTAINS]->(:Episode {relation_type:"duel"})-[:AT_LOCATION]->(l:Location),
      (h)-[:CONTAINS]->(:Episode)-[:VIA_DEVICE]->(d:Device),
      (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l)
RETURN DISTINCT p, n, d, l LIMIT 2000
```

N-ary=0, naive=TIMEOUT, hub≈0 (같은 분 안에 duel + 별도 device 에피소드가 같은
location에 있을 확률 낮음).

---

## 종합 패턴

| 케이스 유형 | naive 실패 양상 | hub 개선 정도 | 잔존 phantom 원인 |
|---|---|---|---|
| 1 (cardinality) | LIMIT 폭발 | ~90%↓ | 분 단위 공동 바인딩 |
| 2 (pure co-occur, n-ary=0) | 100% phantom | ~99%↓ | 허브 내부 재조합 |
| 3 (location bridge) | LIMIT | 부분 | **shared-entity phantom** |
| 4 (dual duel, n-ary=0) | 100% phantom | ~100%↓ | (분당 duel 수 희소) |
| 5 (2-hop reach) | TIMEOUT | 완료 가능 | shared-item within-hub |
| 6 (3-hop co-presence, n-ary=0) | TIMEOUT | 완료 가능 | shared-location within-hub |
| 7 (item+mob+location) | TIMEOUT | 완료 가능 | **다중 shared-entity**, 잔존 큼 |
| 8 (cross-type bridge, n-ary=0) | TIMEOUT | 완료 가능 | (분당 이벤트 타입 희소) |

공식: 허브는 **"같은 분 × 같은 player"** 스코프를 강제하므로 이벤트가 희소한
질문 (cases 4, 8) 은 거의 0-phantom이 되고, 엔티티를 조인 키로 재사용하는
질문 (cases 3, 7) 은 within-hub phantom이 가장 크게 남는다.
