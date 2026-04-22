# Thesis — Cross-episode leakage

## 한 줄 명제

n-ary relation은 **스키마 수준에서** 에피소드 경계를 강제하므로 pair-wise
traversal이 일으키는 cross-episode phantom을 구조적으로 차단한다. Pair-wise
그래프가 같은 정확도를 얻으려면 **episode 재피화 + 쿼리 규율**이 필요하고,
이는 저장·쿼리 비용을 따로 먹힌다.

## 문제의 구체적 모습

MMORPG 로그 1,000건을 두 가지 방식으로 저장:

### A. n-ary (TypeDB)

```
episode(ep-0042) [
  actor        : P1,
  counterpart  : N2,
  item_payload : I4,
  at_location  : L3,
  relation_type: "trade",
  minute_bucket: 29614202,
  ...
]
```

하나의 `episode` relation 인스턴스가 모든 role 바인딩을 원자적으로 가짐.

### B. 재피화 triplet (FalkorDB)

```
(:Episode {id: "ep-0042", relation_type: "trade", ...})
  -[:ACTOR       ]-> (:Player   {id: "P1"})
  -[:COUNTERPART ]-> (:NPC      {id: "N2"})
  -[:ITEM_PAYLOAD]-> (:Item     {id: "I4"})
  -[:AT_LOCATION ]-> (:Location {id: "L3"})
```

같은 의미, 다른 표현. 정확히 같은 nodes/edges 수로 저장.

## 왜 leakage가 생기나

Cypher는 바인딩 재사용을 **코드 작성자의 규율**에 의존합니다. 올바른 질의:

```cypher
# "P1이 N2에게 I4를 L3에서 거래?" — 모든 role이 같은 episode에 속해야 함
MATCH (e:Episode)-[:ACTOR]->(:Player {id:"P1"}),
       (e)-[:COUNTERPART]->(:NPC {id:"N2"}),
       (e)-[:ITEM_PAYLOAD]->(:Item {id:"I4"}),
       (e)-[:AT_LOCATION ]->(:Location {id:"L3"})
RETURN e
```

naive 질의 — 단일 `e` 변수를 잊고 역할마다 anonymous Episode를 다시 바인딩:

```cypher
MATCH (:Episode)-[:ACTOR]->(:Player {id:"P1"}),
       (:Episode)-[:COUNTERPART]->(:NPC {id:"N2"}),
       (:Episode)-[:ITEM_PAYLOAD]->(:Item {id:"I4"}),
       (:Episode)-[:AT_LOCATION]->(:Location {id:"L3"})
RETURN *
```

네 개의 각각 다른 `:Episode`가 서로 다른 이벤트와 매칭돼 cartesian product
→ 실제로 한 번도 같이 일어나지 않은 조합을 "존재한다"고 답변.

TypeDB는 의미적으로 이런 실수를 할 수 없습니다. 하나의 `$e isa episode,
links(...)`는 *한* relation 인스턴스에 모든 role이 매여 있음을 TypeQL
문법 자체가 요구합니다. 구조가 올바른 질의를 강제.

## 8 케이스 측정 결과 (seed 42)

| Case | kind | TypeDB hyperedge | FalkorDB naive Cypher | 결과 |
|---|---|---:|---:|---|
| 1 P1·I4·L3 사용 | cardinality | 14 episodes | 2,000 (LIMIT) | cardinality dilution |
| 2 kill M7 with N2 | co_occur | **0** | 2,000 (LIMIT) | **pure phantom** |
| 3 I5+N1 공동 위치 | co_occur | 5 | 500 (LIMIT) | phantom |
| 4 duel N4+N6 | co_occur | **0** | 2,000 (LIMIT) | **pure phantom** |
| 5 item→location reach | multi_hop | 777 | TIMEOUT | 카티전 폭발 |
| 6 NPC·mob·location | multi_hop | **0** | TIMEOUT | 카티전 폭발 |
| 7 item+mob 같은 L | multi_hop | 213 | TIMEOUT | 카티전 폭발 |
| 8 duel+device 2-hop | multi_hop | **0** | TIMEOUT | 카티전 폭발 |

`hyperedge=0` 에 `triplet>0` 인 케이스(2, 4, 6, 8)는 **존재하지 않은 사건
조합**을 triplet 그래프가 유효 경로로 반환한 100% phantom.

Multi-hop 4개 case의 TIMEOUT 자체가 가장 강한 시연 — naive 4+ Episode
바인딩은 1,000 × 1,000 × 1,000 … 에 가까운 카티전을 만들어 FalkorDB가
정해진 시간 안에 완료할 수 없습니다. TypeDB의 n-ary 등가 질의는 5–25ms 내
정답을 돌려줍니다.

## 그래서 어떻게 받아들여야 하나

- **"n-ary가 저장/쿼리 비용이 더 비싸다"** → 맞다. Episode 단위 원자성을
  지키면 attribute-binding이 많아지고 단순 질의는 triplet보다 느림.
- **"그럼 triplet 쓰면 되는 것 아닌가?"** → 재피화까지 해서 데이터 파리티
  맞춰도, 질의가 naive할 때 cross-episode phantom이 구조적으로 발생함.
  phantom 없애려면 (a) proper Cypher 규율 (작성자 책임) + (b) 에피소드 지식
  유지 + (c) 많은 경우 JOIN 비용 더 큼.
- **n-ary의 기여** — "정답 질의의 구조"를 스키마에 내장함. 작성자가 실수할
  수 있는 여지 자체를 없앰. 저장·속도 트레이드오프를 받는 대신.

## 세 번째 티어 — Time×Player Hub

원 실험은 이분법 (triplet vs n-ary) 이었지만, 이후 중간 티어로
`TimePlayerHub` 를 추가했다. 각 (minute_bucket, player_id) 가 1급 시민 노드가
되어 `CONTAINS` 엣지로 자신의 에피소드들을 묶는다. 쿼리가 모든 `:Episode`
참조에 `(h)-[:CONTAINS]->` 를 공유하면 **스코프가 한 분으로 강제**돼 naive
대비 phantom은 90%+ 감소하고 multi-hop의 TIMEOUT도 풀린다.

그러나 허브는 근사치일 뿐이다. 두 구조적 한계가 남는다:

1. **허브 내부 재조합** — 같은 허브 안 서로 다른 에피소드의 role이 여전히
   자유 재조합 가능
2. **2-hop 공유 엔티티 경유** — `:Location`, `:Item` 같은 엔티티는 글로벌
   노드로 남아 허브와 허브 사이를 bridge 할 수 있음

상세는 `hub-limitations.md`, `schema-tiers.md` 참고. 요약:

- **허브** = 시간 근접을 통한 phantom **통계적 감소**
- **n-ary** = 문법으로 강제되는 **구조적 0**

이 둘은 대부분의 질문에서 상관이 높지만 동일하지 않다.

이 저장소는 이 트레이드오프를 재현 가능한 숫자로 측정합니다. [benchmark.md]
에 저장·지연 수치, [leakage-cases.md]에 각 case의 TypeQL/Cypher 쌍이 있습니다.
