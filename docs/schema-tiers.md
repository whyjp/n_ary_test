# 스키마 3-티어 — 경계 보존과 규율 비용의 스펙트럼

n-ary vs pair-wise의 2분법은 경계 보존 강도와 쿼리 규율을 뭉뚱그린다. 이
저장소는 세 번째 중간 티어를 추가해 **"어디서 경계를 강제할 것인가"** 를
연속 스펙트럼으로 다룬다.

| 티어 | 경계 보존의 매체 | 쿼리 작성자의 역할 | 스토리지 부담 |
|---|---|---|---|
| **triplet_naive** | 없음 | 각 `:Episode`가 익명 — 작성자가 공유 변수를 잊으면 phantom | 가장 적음 |
| **triplet_hub** | `TimePlayerHub` 노드 + `CONTAINS` 엣지 (1-hop) | 모든 `:Episode` 참조에 `(h)-[:CONTAINS]->` 프리픽스 공유 | 허브 노드 + 1000 CONTAINS edge |
| **n-ary (TypeDB)** | `episode` relation 인스턴스 (문법 수준) | `$e isa episode, links(...)` 한 줄 | attribute binding 정규화로 4× blowup |

## 1. `triplet_naive` — 가장 단순, 가장 위험

```cypher
MATCH (:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
      (:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
RETURN p, m, n
```

세 개의 `:Episode`는 완전히 독립. P1이 한 번이라도 등장한 episode × M7이
등장한 episode × N2가 등장한 episode의 cartesian. 실제로 같이 일어난 적이
없는 조합도 "존재"로 반환된다.

**규율 부담**: 100% 작성자 책임. 공유 변수 `e:Episode`를 잊으면 leakage.

## 2. `triplet_hub` — 1-hop 스코프 강제

```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
      (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
RETURN p, m, n
```

`h`는 한 매치당 하나의 허브 (minute × player). 네 `:Episode`는 모두 같은
1분 윈도우 안의 이벤트 — cartesian 공간이 999 → ≈16으로 축소.

**규율 부담**: 작성자가 모든 `:Episode` 참조에 `(h)-[:CONTAINS]->` 를
일관 적용해야 함. 빠뜨리면 naive와 동일해짐.

**구조적 한계 두 개** — `hub-limitations.md` 참조:
- 같은 허브 안 서로 다른 이벤트의 role 재조합 (within-hub)
- 2-hop 공유 엔티티 경유 cross-hub route

## 3. `n-ary (TypeDB)` — 스키마 문법이 경계를 요구

```tql
match
  $p isa player,  has player_id "P1";
  $m isa mob,     has mob_id "M7";
  $n isa npc,     has npc_id "N2";
  $e isa episode, links (actor: $p, mob_target: $m, counterpart: $n);
select $e;
```

`$e` 하나가 *하나의 relation 인스턴스*의 모든 role 바인딩을 묶음. TypeQL
문법이 이 구조를 요구하므로 "바인딩을 잊을" 자유가 없다.

**규율 부담**: 없음 (스키마가 강제).

## 티어 비교 요약

| 지표 | triplet_naive | triplet_hub | n-ary |
|---|---:|---:|---:|
| 스토리지 records (1000 eps) | 4,589 | ≈5,650 | 19,574 |
| Phantom (cases 2+4, LIMIT 2000) | 4,000+ | 0~수십 | **0** |
| Multi-hop completion (cases 5-8) | TIMEOUT | ≤수백 ms | 5-25 ms |
| 작성자 규율 | 100% | 60% | 0% |
| 경계 보존 | ❌ | ⚠️ 1-hop만 | ✅ 문법 수준 |

## 어느 티어를 선택해야 하나

결정 요인:
- **질의가 한 에피소드 안의 여러 role 바인딩을 묻는가?** → 허브 이상 필요
- **Multi-hop traversal이 있는가?** → 허브 이상 필요 (naive는 TIMEOUT)
- **쿼리 작성자의 규율을 신뢰할 수 있는가?** → 허브로도 충분
- **규율 실수가 prod 장애로 이어지는가?** → n-ary
- **엔티티 공유가 많은 도메인인가?** (소셜, MMORPG, 로그 이벤트 등) → n-ary
  (허브도 shared-entity 경유 cross-hub phantom을 막지 못함)

**허브는 마이그레이션 경로로 유용**하다. 기존 FalkorDB/Neo4j 인프라를 유지
하면서 스코프 강제를 도입한 뒤, phantom 잔존량이 비즈니스 허용치를 넘는
질의가 나오면 n-ary로 옮긴다.
