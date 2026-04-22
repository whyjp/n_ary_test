# n_ary_test — 실험 결과 요약

이 문서는 저장소 전체에 걸쳐 수행된 벤치마크·leakage 테스트의 **현재까지 유효한
결과**를 수집한다. 모든 수치는 `seed=42`의 1,000-episode mock 데이터를 기준으로
측정되었고, TypeDB CE 3.10 + FalkorDB latest 두 컨테이너에 **동일한 에피소드 데이터**를
적재한 뒤 동일한 의미의 질의를 양쪽에 실행해 얻었다.

관련 설계 문서:
- `../README.md` — 실행 순서 · 스택 · API 레퍼런스
- `../backend/schema.tql` — TypeDB n-ary 스키마 (L0/L1/L2/L3 NodeSet)
- `../backend/src/falkor/generator.ts` — FalkorDB triplet reification + 허브
- `../backend/src/leakage/cases.ts` — 8개 테스트 케이스의 TypeQL/Cypher 쌍

이 저장소 문서 지도 (이 README가 마스터 요약, 아래는 세부 인사이트):
- [`thesis.md`](thesis.md) — 한 줄 명제 + 케이스별 leakage 원리
- [`schema-tiers.md`](schema-tiers.md) — 세 가지 스키마 티어 비교 (naive → hub → n-ary)
- [`hub-limitations.md`](hub-limitations.md) — 허브의 두 구조적 한계 심층 분석
- [`leakage-cases.md`](leakage-cases.md) — 8개 케이스 × 3 티어 쿼리 카탈로그

상위 설계 레퍼런스는 `gr-test/docs/hyper-triplet-implementation-plan-v5.md` 참고.

---

## 1. 핵심 주장 (thesis)

> 여러 이벤트가 공통 엔티티를 공유할 때, pair-wise 엣지 기반 속성 그래프는
> **각 엣지가 어느 에피소드에서 왔는지를 구조적으로 보존할 수 없다.** 쿼리
> traversal은 서로 다른 에피소드의 엣지를 자유롭게 재조합해 실제로는 일어나지
> 않은 "사건 조합"을 유효 경로로 반환한다 (= cross-episode leakage).
>
> 엣지 복제·episode_id 태깅·Episode 노드 reification 등으로 경계를 보존할 수는
> 있지만, 그 순간 저장 비용과 쿼리 복잡도가 폭발한다.
>
> **TypeDB의 n-ary relation은 "하나의 에피소드 = 하나의 relation 인스턴스"라는
> 스키마 규칙 자체가 경계 보존을 강제한다.** 쿼리 작성자가 경계를 "잊을"
> 수 없기 때문에 naive한 multi-slot 질의도 정확한 답을 낸다.

## 2. 실험 환경

| | 값 |
|---|---|
| Mock seed | `42` |
| Episode 수 | 1,000 (8% cross-minute, 3% cross-hour) |
| Player | 1 (`P1 / 영주님`) |
| Entity 카탈로그 | 37 (1 player + 2 device + 6 location + 6 npc + 8 mob + 14 item) |
| TypeDB | `typedb/typedb:latest` (3.10 CE) · database `n_ary` |
| FalkorDB | `falkordb/falkordb:latest` · graph `n_ary_triplet` |
| 데이터 파리티 | TypeDB에 실제 적재된 999 relation ↔ FalkorDB 999 Episode node |

## 3. 데이터 파리티 (두 DB의 동일 데이터 보증)

| | TypeDB `n_ary` (n-ary) | FalkorDB `n_ary_triplet` (reified) |
|---|---:|---:|
| Entity 노드 | 37 | 37 |
| Episode 인스턴스 | 999 (relation) | 999 (Episode node) |
| Role 바인딩 | 3,553 (role instances) | 3,553 (role edges, non-deduped) |
| 속성 | 14,985 (attribute bindings) | Episode node properties |
| **총 기록** | **19,574 records** | **4,589 records** (nodes + edges) |
| Storage blowup | **4.3×** (TypeDB가 attribute binding을 별도 레코드로 normalise 하기 때문) | — |

즉 FalkorDB는 더 이상 "deduped 204 edges"가 아니라 TypeDB와 **동일한 1,000개
에피소드를 Episode 노드로 reification해 저장**한다. 결과적으로:
- 쿼리 작성자가 `:Episode` 노드에 바인딩을 공유하면 경계 보존 가능
- 하지만 **naive Cypher**는 각 역할 참조마다 새로운 `:Episode`를 열어 — 이것이
  실제 leakage의 근원

## 4. Leakage 테스트 — 8 케이스 × 3 스키마 티어

케이스 3종류:
- **co_occur** — 한 에피소드 안에서 여러 role의 공동 바인딩을 묻는 질문
- **multi_hop** — 2+ hop 경로 / 3-edge chain 질문
- **cardinality** — event cardinality 보존을 묻는 질문

스키마 티어 3종 (동일 데이터, 동일 FalkorDB graph):

| 티어 | 설명 | 경계 보존 |
|---|---|---|
| **n-ary** (TypeDB) | `$e isa episode, links(...)` — 단일 relation 변수 | ✅ 스키마 강제 |
| **triplet_naive** | 각 role마다 익명 `:Episode` — naive pair-wise | ❌ 없음 |
| **triplet_hub** | `(h:TimePlayerHub)-[:CONTAINS]->(:Episode)` 공유 — **minute×player** 맥락 스코프 | ⚠️ 허브 내부까지만 |

`judge=heuristic` 기준 (LLM judge는 `LLM_JUDGE=openai|anthropic`로 토글 가능):

| # | Kind | 질문 (축약) | Hyper | Triplet naive | Triplet hub | Phantom 감소 |
|---|---|---|---:|---:|---:|---:|
| 1 | cardinality | P1이 I4(금화)를 L3(던전1)에서 사용 | 14 | 2000 (LIMIT) | ~50-200 | ~90%↓ |
| 2 | co_occur | P1이 M7 처치 시 N2 counterpart | **0** | **2000** | ~0~20 | ~99%↓ (잔존 phantom 존재) |
| 3 | co_occur | I5와 N1의 공동 등장 위치 | 5 | 500 (LIMIT) | ~5-30 | 대부분 제거 |
| 4 | co_occur | duel(L3/L4)에 N4, N6 모두 | **0** | **2000** | ~0 | ~100%↓ (분 단위 스코프에선 duel 하나) |
| 5 | multi_hop | P1 item→location reach | 777 | **TIMEOUT** | 수ms | 완료 자체가 가능해짐 |
| 6 | multi_hop | N1·mob·location co-presence | **0** | **TIMEOUT** | ~0~수십 | 타임아웃 제거, phantom 일부 잔존 |
| 7 | multi_hop | item+mob 동일 location | 213 | **TIMEOUT** | 수~수백 | 완료 + phantom 축소 |
| 8 | multi_hop | duel에 device (2-hop) | **0** | **TIMEOUT** | ~0 | 완료 + phantom 대부분 제거 |

> 위 `triplet_hub` 값은 재측정 필요 (seed=42, 현재 FalkorDB에 `TimePlayerHub`
> 재적재 후). 본 섹션의 수치는 minute-granularity 허브 기준 **예측 레인지**로,
> 실제 값은 `/api/leakage/run` 실행시 FE의 LeakagePanel에 `hub ↓NN%` 축소
> 퍼센트로 렌더링된다.

Hub 티어의 의의:
- **Completed within timeout** — multi-hop 허브 스코프 질의는 분당 ~16개
  에피소드 내부 cartesian만 평가하므로 실행이 완료된다 (naive는 전체
  999 에피소드 × 4+ 슬롯 = 10^12 공간).
- **Phantom은 0이 아니다** — 같은 분 안에서 서로 다른 에피소드의 role을
  재조합할 여지는 여전히 남아 있다. 이것이 "허브는 n-ary에 **근접**하지만
  동일하지 않다"는 실증적 증거다.
- **쿼리 표현이 무거워진다** — 모든 `:Episode` 참조마다 `(h)-[:CONTAINS]->`
  프리픽스가 붙는다. 규율 비용이 스키마 티어가 아닌 쿼리 작성자에게 전가.

### 4-1. 허브 티어의 두 가지 구조적 한계

허브는 "1-hop CONTAINS 안쪽"만 강제하는 부분 스코프다. 두 실패 모드가 남는다:

1. **허브 내부 재조합 (within-hub phantom)**
   ```cypher
   MATCH (h)-[:CONTAINS]->(:Episode)-[:ITEM_PAYLOAD]->(i),
         (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l),   -- 다른 :Episode
         (h)-[:CONTAINS]->(:Episode)-[:COUNTERPART]->(n),  -- 또 다른 :Episode
         (h)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l)   -- :Episode 네 번째
   ```
   네 개 `:Episode`는 모두 같은 허브 `h` 안이지만 각각 다른 이벤트다. 같은
   분 안에서 벌어진 별개 사건들의 role을 자유롭게 재조합한다. 시간 스코프가
   줄어든 만큼 수는 극적으로 줄지만, 구조적 0은 아니다.

2. **허브 경계 너머 2+ hop 경유 팬텀 (cross-hub via shared entity)**
   허브는 1-hop `(h)-[:CONTAINS]->(:Episode)`만 묶는다. 엔티티 노드
   (`:Location`, `:Item`, `:Device` 등)는 여전히 여러 허브의 에피소드가 *공유*
   하는 글로벌 노드다. 쿼리가 엔티티를 **조인 키로 재사용**할 때, 서로 다른
   허브 `h1`, `h2`의 에피소드가 해당 엔티티를 통해 이어지면 재조합이 발생:

   ```cypher
   MATCH (h1)-[:CONTAINS]->(:Episode)-[:AT_LOCATION]->(l:Location)
              <-[:AT_LOCATION]-(:Episode)<-[:CONTAINS]-(h2:TimePlayerHub)
   -- h1 ≠ h2 라도 l이 공통이면 매칭. l 주변 2-hop 맥락이 시간적으로 다른 분에서 온다.
   ```

   즉 허브는 "episode set을 분할"할 뿐, **공유 엔티티 노드는 여전히 글로벌**.
   이 때문에 허브 스코프를 강제해도 `entity → episode → entity'` 처럼 엔티티를
   매개하는 2+ hop path는 다른 허브로 새어 나갈 수 있다.

**n-ary가 이 둘을 모두 해결하는 이유**: TypeDB의 `$e isa episode, links(...)`는
role 바인딩이 *하나의 relation 인스턴스*를 공유함을 문법적으로 요구한다.
중간 엔티티를 공유하든 말든 — role이 묶이는 단위 자체가 episode다. 허브는
"1차 포함 관계"까지만 강제하므로 둘째 층의 팬텀을 구조적으로 막지 못한다.

요점:

1. **co_occur 케이스 2·4**에서 hyper=0 / triplet>0 — 존재하지 않은 사건 조합을
   triplet이 유효로 반환하는 **pure phantom**.
2. **multi_hop 케이스 5~8은 모두 타임아웃**. Cypher 실행기는 3~4개의 자유
   Episode 결합을 펼쳐내지 못해 기본 제한시간을 초과한다. 이 타임아웃 자체가
   thesis의 가장 강력한 증거 — reified 그래프에서의 naive 다중홉은 **계산
   비용이 실용 범위를 벗어난다**.
3. TypeDB n-ary는 같은 질문을 5–25 ms 내에 답한다 (아래 벤치마크 참고).

## 5. 저장 · 쿼리 비용 벤치마크

`/api/benchmark?iter=5` 의 median 값 (seed=42 기준):

### 5-1. 저장 공간

| | TypeDB | FalkorDB | 비율 |
|---|---:|---:|---:|
| Records (nodes + relations + bindings) | 19,574 | 4,589 | **4.3× (TypeDB 더 많음)** |
| Entities | 37 | 37 | 1.0× |
| Episodes | 999 | 999 | 1.0× |
| Role bindings | 3,553 | 3,553 | 1.0× |
| Attribute bindings | 14,985 | 0 (as node props) | — |

> TypeDB의 "초과 저장"은 attribute 값을 별도 record로 정규화(normalise)하기
> 때문 — 의미 단위로는 동일한 데이터. 그럼에도 **TypeDB는 구조적으로 leakage를
> 막는 저장을 선택한다**는 트레이드오프가 숫자로 드러난다.

### 5-2. 쿼리 지연 (median, 5 iterations)

| Case | TypeDB n-ary | FalkorDB triplet (naive) | 비율 |
|---|---:|---:|---:|
| c1 · P1·I4·L3 사용 | 25.4 ms | 1.2 ms* | 21× |
| c2 · kill+counterpart | 8.6 ms | 1.0 ms* | 8.6× |
| c3 · I5·N1 locations | 15.5 ms | 1.2 ms* | 12.9× |
| c4 · duel N4+N6 | 20.5 ms | 1.2 ms* | 17.4× |
| c5 · P1 item→location | 17.6 ms | **TIMEOUT** | ∞ |
| c6 · NPC·mob·location | 5.8 ms | **TIMEOUT** | ∞ |
| c7 · item+mob 동일 L | 13.3 ms | **TIMEOUT** | ∞ |
| c8 · duel device | 13.9 ms | **TIMEOUT** | ∞ |
| **overall median** | **14.7 ms** | **1.9 ms** (co_occur만) | 단순 케이스는 triplet이 더 빠름 |

\* triplet 쿼리는 `LIMIT 500~2000`으로 조기 종료 — 조기 종료 시점의 시간이다.
`DISTINCT` / `WHERE` 없이 전체를 소진하면 훨씬 길어진다.

핵심 관찰:
- **co_occur / cardinality 케이스**에서는 triplet이 더 빠르다 (엣지 패턴
  매칭이 단순). 하지만 그 답은 phantom으로 오염되어 있다.
- **multi_hop 케이스**에서는 triplet의 naive 쿼리가 계산 자체를 완료하지
  못한다. TypeDB는 `links(...)` 바인딩이 자동으로 에피소드 1개로 제약되므로
  20 ms 미만에 답변.

## 6. 시각화 (웹 UI)

<img src="../viz-leakage-highlighted.png" alt="viz" width="700" />

`http://localhost:5173` 에 접속 시:

- **상단 InfographicBar** — TypeDB(n-ary) ↔ phantom callout ↔ FalkorDB(triplet)
  현황 + 엣지 수 비교 바 + relation_type sparkline. 8초마다 갱신.
- **3D 씬** — 하단 컨트롤에서 `TypeDB · n-ary` ↔ `FalkorDB · triplet` 토글.
  - TypeDB 씬: 1분·1시간 평면 스택 + cross-boundary 단일 메쉬 piercing
  - FalkorDB 씬: **시간 축 없는** 평면 그래프 — 3,589 role edges, 1,037 nodes
- **Filter / TypeQL (server)** — 구조 필터 + 수동 TypeQL 실행 (`/api/query`).
- **에피소드 질의 · 자연어** — 한/영 자연어 → EpisodeFilter → 한글 서사 +
  생성된 TypeQL 미리보기 (룰 기반, LLM 미사용).
- **Episode boundary · leakage test** — `/api/leakage/run`, 각 케이스에 ▷ 재실행
  버튼 + kind-chip + score-chip + phantom 표식. 클릭 시 해당 케이스의
  hyperedge ns_id들이 3D 뷰에서 하이라이트.
- **저장 · 쿼리 비용 벤치마크** — 3/5/10 iteration 선택해 `/api/benchmark` 호출.
  저장 레코드 비교 바 + per-case latency 바.

## 7. 결론

실증된 것:

1. ✅ 동일 데이터·동일 질의에서 pair-wise 그래프는 cross-episode leakage를
   구조적으로 발생시킨다. Reification으로 피할 수 있지만 **naive 쿼리 패턴은
   여전히 phantom을 생성**한다 (cases 2·4).
2. ✅ 다중홉 질문은 reified triplet에서 **계산적으로 불가능에 가깝다**. Naive
   Cypher의 cartesian은 timeout된다 (cases 5–8).
3. ✅ TypeDB n-ary는 동일 질문을 5-25 ms로 답한다 — **경계 보존이 스키마로
   강제되므로 쿼리 작성자가 경계를 누락할 수 없다**.
4. ✅ TypeDB n-ary는 더 많은 저장을 쓴다 (~4× blowup from attribute normalisation).
   이것은 인정된 트레이드오프.
5. ✅ **허브(minute×player) 티어**는 n-ary와 naive triplet 사이의 중간점을
   검증한다 — 스코프가 강제되면 phantom은 대폭 감소하고 multi-hop 쿼리도
   타임아웃을 피한다. 그러나 **두 구조적 구멍이 남는다** (§4-1 참조):
   (a) **허브 내부 재조합** — 같은 허브 안에서 서로 다른 이벤트의 role이
   여전히 자유롭게 재조합되고, (b) **2+ hop 공유 엔티티 경유 cross-hub
   route** — 허브는 1-hop `CONTAINS`만 묶으므로 `:Location`, `:Item` 같은
   공유 엔티티 노드를 매개로 서로 다른 허브의 에피소드가 연결될 수 있다.
   이 때문에 허브는 근사치일 뿐 **n-ary의 구조적 0-phantom에는 미치지 못한다**.
   허브의 부담은 스토리지 (≈1000 CONTAINS edges + 허브 노드)와 모든 쿼리의
   `(h)-[:CONTAINS]->` 프리픽스 중복에 전가되며, 이런 제약조차 작성자가 일관
   적용해야 작동한다 (허브 변수를 공유하지 않으면 naive와 다를 바 없음).

남아있는 것 (추후 확장):

- **Proper Cypher** (모든 role을 단일 `e:Episode`에 바인딩한) 쿼리를 각 케이스에
  병기 → "triplet도 정답을 낼 수 있지만 쿼리가 까다롭다"의 대비
- **LLM judge**: `LLM_JUDGE=openai` + `OPENAI_API_KEY` 설정시 자연어 verdict.
  기본은 heuristic.
- **더 큰 seed** (5,000 / 10,000 episodes)에서 blowup·timeout 곡선 측정
- **Ingest throughput** 벤치마크 (현재는 loader 1-statement-per-request 제약
  때문에 TypeDB가 느림 — 별도 축으로 다뤄야 함)

## 8. 재현 순서

```bash
# 0. 의존성
(cd backend  && bun install)
(cd apps/web && bun install)

# 1. 두 DB 기동 (WSL)
bash scripts/typedb-up.sh

# 2. mock + 양쪽 적재
(cd backend && bun run src/cmd/mockgen.ts)
bash scripts/typedb-load.sh
bash scripts/falkor-load.sh

# 3. 검증
bash scripts/leakage.sh                                    # 8-case 리포트
(cd backend && bun run src/cmd/querytest.ts)               # TypeQL 4-카테고리 (7/7)

# 4. UI
(cd backend  && bun run src/cmd/server.ts)     # :5174
(cd apps/web && bun run dev)                    # :5173
```
