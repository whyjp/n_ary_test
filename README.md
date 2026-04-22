# n_ary_test — n-ary 하이퍼엣지로 Cross-episode Leakage를 막는다

> **핵심 주장 (single thesis):**
>
> Pair-wise 엣지 기반 속성 그래프는 사건들을 공통 엔티티로 이어붙이는 과정에서
> **서로 다른 에피소드의 엣지가 traversal 단계에 재조합**되어, 실제로는 일어나지
> 않은 "사건 조합"을 유효 경로로 반환한다. 엣지 복제로 경계를 보존하려면
> 저장·쿼리 비용이 폭발한다. **TypeDB의 n-ary relation = 에피소드 경계 그
> 자체**라서 이 leakage를 구조적으로 없애면서 비용 폭발도 피한다.
>
> 이 저장소는 위 주장을 **동일 데이터 + 동일 질의 + 두 저장소 (TypeDB 3 / FalkorDB)
> 병렬 실행**으로 실증한다.

## 실증 결과 (seed 42, 1,000 episodes)

`bun run backend/src/cmd/leakage-test.ts` — 4개의 의미적으로 동등한 질의를
양쪽 그래프에 날린 결과:

```
Case 1 · P1이 I4(금화)를 L3(던전1)에서 사용
  hyperedge=14   triplet=1    ratio 0.07×
  → n-ary는 14개 에피소드를 모두 반환 (event cardinality 보존).
    triplet은 USED_ITEM/ITEM_AT_LOCATION 엣지가 에피소드에 걸쳐 dedupe 되어 1.

Case 2 · P1이 M7(드래곤새끼) 처치 시 N2(퀘스트주인)가 counterpart?
  hyperedge=0    triplet=1    ratio ∞×   ⚠ PHANTOM
  → 생성기는 mob_target과 counterpart를 같은 에피소드에 바인딩하지 않음.
    n-ary는 0을 반환(사실). triplet은 P1→M7, P1→N2 엣지가 서로 다른 에피소드에서
    왔음에도 결합되어 1을 반환 → 가짜 경로.

Case 3 · I5(보석)와 N1(상인)의 공동 등장 위치
  hyperedge=5    triplet=6    ratio 1.20×
  → 1개 위치는 I5와 N1이 한 에피소드에서 함께 나타난 적이 없음에도 triplet이 반환.

Case 4 · L3/L4 던전에서 N4와 N6 모두를 counterpart로 하는 듀얼
  hyperedge=0    triplet=2    ratio ∞×   ⚠ PHANTOM
  → duel은 counterpart 1명. n-ary는 0(사실). triplet은 두 개의 별개 duel의
    counterpart 엣지를 자유롭게 결합 → 2개 가짜 경로.

totals  hyperedge=19  triplet=10  phantom=3
```

- **3개 phantom 경로** — 존재하지 않은 "사건 조합"을 pair-wise 그래프가 유효
  경로로 반환. n-ary `episode` relation은 스키마 수준에서 역할 동시 바인딩을
  강제하므로 원천 차단.
- 저장 비교: 1,000 에피소드 = 1,000 n-ary relation 인스턴스 vs **37 노드 /
  204 고유 pair-wise 엣지** (FalkorDB). Pair-wise 쪽의 "압축된 크기"는
  에피소드 경계 소실의 결과이며, 경계를 보존하려면 엣지 복제(또는 엣지마다
  `episode_id` 태깅 + 쿼리에 항상 JOIN)가 필요해 **에피소드 × 역할-쌍 수**만큼
  엣지가 불어난다.

## 두 저장소 · 공통 시각화

![viz screenshot](viz-leakage-run.png)

- 3D 뷰: TypeDB `n_ary` 의 1분/1시간 평면에 쌓인 n-ary 하이퍼엣지
- 우측 `Episode boundary · leakage test` 패널: `/api/leakage/run` 호출 결과를
  4-case 단위로 표시. PHANTOM case는 빨간 테두리로 강조.
- 각 case를 클릭 → 해당 case의 hyperedge `ns_id`들을 3D 뷰에서 하이라이트.
- 좌측 `에피소드 질의 · 자연어`: 한/영 자연어 질의 → 필터링된 에피소드를 문장형
  서사로 렌더링 + 생성된 TypeQL 미리보기.

## NodeSet 스키마 (hyper-triplet v5)

각 로그 한 줄 = 하나의 `episode` relation 인스턴스 + 4-layer 소유 속성:

| Layer | 소유자 | 예시 |
|---|---|---|
| L0 사실 | `relation_type` + role 플레이어 | `kill_mob(actor=P1, mob_target=M3, at_location=L3)` |
| L1 시간·중요도 | `event_time`, `minute_bucket`, `hour_bucket`, `valid_from/until`, `importance`, `belief` | 10:04:53 → 10:05:14 (분 경계 횡단) · importance=0.72 |
| L2 맥락 | `activity_type`, `mood` | `combat / aggressive` |
| L3 파생 | `community_id`, `source_ref`, `ns_id` | `c_combat_L3`, `kafka://events/412` |

역할(role)은 6종: `actor`, `counterpart`, `mob_target`, `item_payload`,
`at_location`, `via_device`. `counterpart`와 `item_payload`는
`@card(0..16)` 으로 다중 바인딩 가능 — 파티 퀘스트, 거래 묶음 등 n-ary
본연의 표현력.

## 스택

| 계층 | 선택 | 비고 |
|---|---|---|
| GraphDB (baseline) | **TypeDB 3.10 CE** | HTTP API `/v1/query`, JWT signin, docker-compose |
| GraphDB (대조군) | **FalkorDB (Redis-based, OpenCypher)** | Bun의 TCP+RESP 직접 호출 (무 드라이버) |
| Backend | **Bun + TypeScript** | mock · 적재 · 번역 · REST API · leakage runner |
| Frontend | **Vite + React 18 + R3F** (bun pkg mgr) | 반응형 CSS Grid HUD, leakage 패널 |
| Scripts | **bash** (WSL) | `scripts/typedb-*.sh` — compose로 두 DB 동시 기동 |

TypeDB 3 용 TS gRPC 드라이버 부재로 HTTP API를 fetch로 호출하며,
`/v1/query` 엔드포인트는 요청당 1개 TypeQL 문장만 커밋하므로 로더가
에피소드·엔티티를 블록 단위로 직렬 전송합니다.

## 디렉터리

```
docker/
  docker-compose.yml           # TypeDB :8000/:1729 + FalkorDB :6379
  Dockerfile                   # TypeDB 스키마만 베이크하는 얇은 래퍼
scripts/
  typedb-up.sh                 # compose up (두 DB 모두 기동)
  typedb-down.sh               # stop (--wipe 로 볼륨 삭제)
  typedb-load.sh               # bun run src/cmd/load.ts 호출
  typedb-query.sh              # ad-hoc HTTP 질의
backend/
  schema.tql                   # TypeDB n-ary episode relation 스키마
  src/
    domain/types.ts            # Episode / NodeSet 타입
    mock/generator.ts          # 한글 MMORPG 로그 1,000건 (seed 42)
    mock/tql.ts                # 한글 라벨 유지하는 TypeQL insert 빌더
    typedb/client.ts           # HTTP signin + Dataset 조립
    falkor/client.ts           # Bun TCP+RESP FalkorDB 클라이언트
    falkor/generator.ts        # Episode → Cypher MERGE 트리플렛
    narrative/translate.ts     # 한/영 자연어 → EpisodeFilter + 한글 서사
    leakage/cases.ts           # 4개 case 선언 (TypeQL + Cypher 쌍)
    leakage/runner.ts          # 양쪽 DB 실행 + phantom 탐지
    cmd/mockgen.ts             # backend/out/{episodes.json, insert.tql}
    cmd/load.ts                # HTTP로 TypeDB에 스키마·데이터 적재
    cmd/load-falkor.ts         # FalkorDB에 트리플렛 적재
    cmd/leakage-test.ts        # 터미널용 리포트
    cmd/server.ts              # REST API (health, episodes, stats, query,
                               #            query/filter, narrative, refresh,
                               #            leakage/run)
    cmd/querytest.ts           # 4-카테고리 TypeQL 쿼리 테스트 (7/7)
apps/web/
  src/
    viz/{TemporalScene,PlaneLayer,TimeNode,EntityMesh,Hyperedge,layout}.tsx
    ui/StatsPanel.tsx          # 왼쪽: Composition
    ui/QueryPanel.tsx          # 왼쪽: 구조 필터 + 수동 TypeQL
    ui/NarrativePanel.tsx      # 왼쪽 하단: 자연어 에피소드 서사
    ui/LeakagePanel.tsx        # 오른쪽: hyperedge vs triplet + phantom
    App.tsx                    # 반응형 CSS Grid HUD
docs/html/temporal_layers_3d.html   # 시각 언어 원본 레퍼런스
```

## 실행 순서 (처음부터 끝까지)

```bash
# 0. 의존성
cd backend  && bun install
cd ../apps/web && bun install

# 1. 두 DB 동시 기동 (WSL 별도 터미널)
bash scripts/typedb-up.sh

# 2. mock 생성
cd backend
bun run src/cmd/mockgen.ts

# 3. 두 DB에 적재
bun run src/cmd/load.ts --reset         # TypeDB n_ary (hyperedge)
bun run src/cmd/load-falkor.ts --reset  # FalkorDB n_ary_triplet (pair-wise)

# 4. 검증
bun run src/cmd/querytest.ts            # 4-카테고리 TypeQL 테스트 (7/7)
bun run src/cmd/leakage-test.ts         # leakage 비교 CLI 리포트 (phantom=3)

# 5. 서버 + 웹
bun run src/cmd/server.ts               # http://localhost:5174
# (apps/web/ 에서)
bun run dev                             # http://localhost:5173  -- /api 프록시됨
```

## REST API

| Method · Path | 용도 |
|---|---|
| `GET  /api/health` | dataset 크기 + TypeDB 연결 상태 + data source |
| `GET  /api/episodes` | 전체 `Dataset` (엔티티 카탈로그 + 에피소드) |
| `GET  /api/stats` | 분/시 bucket 카운트 + cross-boundary 총합 |
| `GET  /api/query/filter?...` | 구조 필터 (relation/activity/entity/...) |
| `POST /api/query`  `{ tql }` | TypeDB에 TypeQL 직접 실행 |
| `POST /api/narrative` `{ question }` | 자연어 → EpisodeFilter → 한글 서사 |
| `GET  /api/leakage/run` | 4 케이스를 TypeDB + FalkorDB에 실행하고 비교 리포트 |
| `POST /api/refresh` | TypeDB에서 dataset 재 pull |

## 설계 결정 요약

- **TypeDB 2 ↔ 3 스위칭**: Node/TS 드라이버가 아직 2.x만 공식 지원이라 한 번
  2.28로 내렸다가, 사용자 요구에 따라 `typedb/typedb:latest`(3.10 CE)로
  되돌리고 HTTP API를 직접 사용.
- **Go → Bun 피벗**: Go 미설치 환경을 감안해 백엔드를 Bun+TS로 통일. 스크립트는
  여전히 bash, DB는 WSL docker.
- **TypeDB 3 HTTP 단일-statement 제약**: `/v1/query` 는 요청당 최초 statement만
  실행. 로더는 에피소드·엔티티 1건 = 1 요청으로 직렬 전송 (동시성 8, isolation
  충돌 시 자동 skip).
- **Player 병합 노드**: 단일 플레이어 전제이므로 actor role은 각 평면 중심의
  time×player 병합 노드에 anchor. 노드 폭발을 줄이고 에피소드 경계 가시화
  강화.
- **Cross-boundary 하이퍼엣지 렌더**: role 플레이어들의 y 좌표를 `valid_from` ·
  `valid_until`이 걸친 평면 사이에 분산 → 단일 메쉬가 2~3 평면을 관통.
- **색상 saturate 완화**: 중첩 영역이 흰색으로 수렴하는 것을 막기 위해 mesh
  블렌딩을 Additive → Normal로 전환, cross-boundary 전용 흰색 halo만 저
  opacity 유지.
- **FalkorDB Bun 클라이언트**: npm 드라이버 없이 net 모듈과 RESP 파서만으로
  GRAPH.QUERY 를 직접 호출 — 외부 의존성 0.
