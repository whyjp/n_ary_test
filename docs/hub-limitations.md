# TimePlayerHub 의 두 가지 구조적 한계

허브 티어 (`(h:TimePlayerHub)-[:CONTAINS]->(:Episode)`) 는 에피소드 경계를
**1-hop 포함 관계**까지만 강제한다. 이 문서는 허브가 근사치일 뿐 에피소드
정체성이 아님을 드러내는 두 가지 실패 모드를 자세히 기술한다.

## 배경: 허브가 하는 일

```
TimePlayerHub(h_m0924_P1)   TimePlayerHub(h_m0925_P1)
       │                              │
   ┌───┴───┐                      ┌───┴───┐
   ▼       ▼                      ▼       ▼
Episode  Episode  ...          Episode  Episode
   │       │                      │       │
   ▼       ▼                      ▼       ▼
Player  Item                   NPC     Location
 P1     I4                     N1      L3
```

- 각 허브는 (minute_bucket, player_id) 조합 하나
- `CONTAINS` 엣지로 같은 분 윈도우 안의 에피소드들을 묶음
- 쿼리가 `h` 변수를 공유하면 모든 에피소드 참조가 같은 허브 안으로 제약됨

이 구조는 확실히 **naive triplet 대비 엄청난 phantom 감소**를 만든다 — 허브당
에피소드는 ~16개로, 999개 전체 공간 대비 1/60로 축소.

그러나 경계 보존은 두 층 더 깊어야 완전하다.

## 한계 1 · 허브 내부 재조합 (within-hub phantom)

같은 허브 안에도 여러 에피소드가 있다. 그 에피소드들은 서로 다른 이벤트 —
구조적으로 별개의 사건이다. 허브는 "같은 1분 안"이라는 시간 근접만 보증한다.

### 실제 쿼리 패턴

```cypher
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"}),
      (h)-[:CONTAINS]->(:Episode)-[:MOB_TARGET]->(m:Mob {id:"M7"}),
      (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n:NPC {id:"N2"})
RETURN p, m, n
```

한 매치에서:
- `h`는 *하나의* 허브 (예: `h_m0924_P1`)
- 세 `:Episode`는 `h` 안의 *서로 다른* 에피소드
- P1이 actor인 이벤트 E1, M7을 처치한 이벤트 E2, N2와 상호작용한 이벤트 E3 —
  세 이벤트가 같은 1분 안에 일어났지만 각각 독립된 사건

n-ary에서 이 셋은 **하나의 relation 인스턴스**에 묶여야 true가 된다. 허브는
"같은 분 안"만 보장하므로 세 이벤트의 role을 교차 조합해 false positive 생성.

### 실증 (cases.ts 중 case 2)

| 티어 | 답변 수 | 의미 |
|---|---:|---|
| n-ary | **0** | 실제로 P1이 M7을 처치하면서 N2가 counterpart인 에피소드 없음 |
| triplet_naive | ~2,000 (LIMIT) | 999 × 999 × 999 공간에서 phantom 폭발 |
| triplet_hub | 0~수십 | 같은 분 안 재조합만 남음 — 실제 seed에 따라 0 가능 |

허브가 case 2의 phantom을 99%+ 줄이지만 0을 보장하지 않는 이유는 **시간
근접이 이벤트 동일성의 대용물이 아니기 때문이다**.

## 한계 2 · 2+ hop 공유 엔티티 경유 cross-hub route

허브는 에피소드만 묶는다. 엔티티 노드 — `Location`, `Item`, `Device` 같은 —
는 여전히 **글로벌 공유 노드**다. 여러 허브의 에피소드가 같은 Location을
가리킬 수 있고, Cypher는 그 Location을 조인 키로 삼으면 서로 다른 허브를
관통하는 path를 만들어낸다.

### 실패 경로

```
h_m0924_P1              h_m0925_P1
   │                       │
   ▼                       ▼
 Episode_A              Episode_B
   │                       │
   ▼                       ▼
Location L3  ←───(같은 L3)───  Location L3
```

`Episode_A`와 `Episode_B`는 서로 다른 분 — 다른 허브 — 하지만 둘 다 `L3`를
터치. 쿼리가 `l:Location`을 조인 키로 쓰면 두 허브 사이의 cross-hub 경로가
유효로 반환된다.

### 실제 문제 쿼리 예

"P1이 L3에서 한 행동이 다른 시간에 N1과 연결되는가?"

```cypher
MATCH (h1:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(e1:Episode)-[:AT_LOCATION]->(l:Location {id:"L3"}),
      (e1)-[:ACTOR]->(p:Player {id:"P1"}),
      (h2:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(e2:Episode)-[:AT_LOCATION]->(l),
      (e2)-[:COUNTERPART]->(n:NPC {id:"N1"})
WHERE h1 <> h2
RETURN p, n, l
```

`h1 ≠ h2`로 서로 다른 허브지만 `l:Location {id:"L3"}` 하나로 양쪽 경로가
이어진다. "L3에서 P1이 한 것" 과 "L3에서 N1이 한 것"을 묶는 것은 의미적으로
정당할 수도 있지만, 질문이 실은 "**같은 에피소드에서** P1과 N1이 L3에 있었나?"
라면 이 쿼리는 완전한 phantom이다. 허브는 여기 개입할 수 없다.

### 더 나쁜 경우 — 암묵적 cross-hub

작성자가 `h1`, `h2`를 구분하지 않고 그냥 허브 변수를 2개 쓰면서 같은 것으로
착각할 수 있다:

```cypher
-- 실수: 두 매치 절에서 허브 변수를 각기 선언
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:ACTOR]->(p:Player {id:"P1"})
MATCH (h:TimePlayerHub {player_id:"P1"})-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location)
-- 위 두 MATCH의 `h`는 Cypher 규칙상 다른 스코프에서는 다른 허브와 바인딩될 수 있음
```

작성자가 허브 재사용을 보장하려면 세심해야 한다.

## 왜 n-ary는 이 둘을 모두 막는가

TypeDB의 `$e isa episode, links(actor: $p, at_location: $l, ...)` 는:

1. **Role 바인딩을 relation 인스턴스 하나에 묶는다** — 허브 안 재조합 불가 (한계 1 해결)
2. **공유 엔티티도 `$e` 하나의 관점에서만 본다** — 같은 `$l`이 두 개의 `$e`를
   암묵적으로 연결할 수 없음. 교차하려면 두 번째 relation을 명시적으로 선언해야
   하고, 그 때는 사용자가 의도한 cross-episode 관계임을 문법적으로 표명한 것이
   된다 (한계 2 해결)

허브는 이 중 (1)에 대해 "분 단위 시간 근접"이라는 근사만 제공하고, (2)에
대해서는 아무 도움도 되지 않는다.

## 허브를 쓰는 게 여전히 의미 있는 이유

- **마이그레이션 경로**: 기존 FalkorDB 인프라를 유지하며 naive → 허브로
  즉시 개선. phantom 90%+ 감소가 수치로 나온다.
- **Multi-hop completion**: naive가 TIMEOUT되는 cases 5-8 은 허브에서 수 ms로
  완료. 계산 가능해지는 것만으로도 큰 차이.
- **투명한 한계**: 위 두 실패 모드는 쿼리 작성자가 명시적으로 인지할 수 있다.
  n-ary는 불가능을 문법으로 금지하고, 허브는 잔존 위험을 문서화 가능한 형태로
  남긴다.

## 실측 (cases.ts 8개를 세 티어로 측정)

수치는 FE의 `/api/leakage/run` 에서 확인. `hub ↓NN%` 축소 퍼센트는:
- 1~4 (co_occur / cardinality): 허브가 85-100% 감소
- 5~8 (multi_hop): 허브가 TIMEOUT을 풀어낸 것만으로 의미. phantom 잔존량은
  case별로 다르며 특히 cases 5, 7 — `(l:Location)`을 조인 키로 재사용 — 에서
  within-hub phantom 잔존이 상대적으로 크다.

## 결론

**허브는 에피소드 정체성 대신 시간 근접을 준다.** 이 둘은 대부분의 실제
질문에서 상관이 높지만 동일하지 않다. n-ary의 0-phantom은 "실제로 같이
일어난 이벤트만 반환" 이라는 구조적 보장이고, 허브의 "phantom 감소"는
**통계적 근사**다.
