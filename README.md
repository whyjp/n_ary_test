# n_ary_test — 시간 배치형 하이퍼엣지 시각화 + TypeDB 쿼리 실증

MMORPG 이벤트 로그 스트림을 1분/1시간 평면으로 쌓고 각 로그 한 줄을
`n-ary 하이퍼엣지(NodeSet)`로 저장·쿼리·시각화하는 데모. 그래프 DB는
**TypeDB 3.10 CE**, 백엔드는 **Bun + TypeScript**, 프론트는 **Vite +
React + React-Three-Fiber**.

모델 기준선은
`docs/gr-test/hyper-triplet-implementation-plan-v5.md`(`D:/github/gr-test`
참조)의 4-layer NodeSet 설계를 따릅니다.

| Layer | 소유자 | 예시 |
|---|---|---|
| L0 사실 | `relation_type` + role 플레이어 | `kill_mob(actor=P1, mob_target=M3, at_location=L3)` |
| L1 시간·중요도 | `event_time`, `minute_bucket`, `hour_bucket`, `valid_from/until`, `importance`, `belief` | 10:04:53 → 10:05:14 (분 경계 횡단) · importance=0.72 |
| L2 맥락 | `activity_type`, `mood` | `combat / aggressive` |
| L3 파생 | `community_id`, `source_ref`, `ns_id` | `c_combat_L3`, `kafka://events/412` |

## 시각화 특징

- **1분 · 60 평면** vs **1h · 2 평면** 토글
- 각 평면 중심의 **Time × Player 병합 노드**(단일 플레이어 전제이므로
  actor role은 항상 이 노드에 anchor됨)
- 여러 평면을 관통하는 **cross-boundary 하이퍼엣지** — 단일 삼각팬
  메쉬가 두/세 평면을 피어싱하며 흰색 additive halo로 강조
- **spacing** / **node** 슬라이더 — 시간 축 여유와 노드 크기 실시간 조절
- 호버 시 평면/엔티티/TimeNode 디테일 툴팁
- 한글 자연어 질의 → 필터 + 한글 서사 출력 + 생성된 TypeQL 미리보기

## 자연어 쿼리 흐름

```
FE NarrativePanel.ask("10:00 이후 던전1 에서 전투")
  └─ POST /api/narrative { question }
     └─ translateAndRun(question, cached_dataset)
        1. translate(): 한/영 정규식 + 동의어 테이블로 EpisodeFilter 추출
        2. filterToTypeql(): 참조용 TypeQL 문자열 생성 (미실행)
        3. applyFilter(): 캐시된 Dataset에 동일 필터 적용
     └─ { matches, narrative, tql, filter } 반환
```

- LLM 미사용 · 룰 기반(오프라인)
- 시간("이후/부터/까지/사이/~"), 엔티티 이름(한글 라벨 매칭), 활동/
  관계 동의어, cross-boundary, 중요도, 기분을 처리
- 결과 TypeQL은 투명성 목적 — 실제 실행은 `/api/query`로 POST하면
  TypeDB에서 실행

## 스택

| 계층 | 선택 | 비고 |
|---|---|---|
| GraphDB | **TypeDB 3.10 CE** | HTTP API (`/v1/query`), JWT signin, `docker compose`로 WSL에서 기동 |
| 데이터 적재 | `/v1/query` 1-statement-per-request | TypeDB 3 HTTP 기 multi-statement 미지원 이슈 회피 |
| 백엔드 | **Bun + TypeScript** | mock 생성 · 적재 · REST API · 자연어 번역 |
| 프론트 | **Vite + React 18 + R3F** (bun pkg mgr) | 반응형 CSS Grid HUD, OrbitControls |
| 스크립트 | **bash** (WSL) | `scripts/typedb-*.sh` |

**주의** — TypeDB 3.x 전용 JS/TS gRPC 드라이버가 아직 없어 HTTP API를
직접 fetch로 호출합니다. `/v1/query` 엔드포인트는 요청당 한 TypeQL
문장만 커밋하므로 loader가 에피소드·엔티티를 블록 단위로 분할 전송
합니다.

## 디렉터리

```
docker/
  docker-compose.yml          # TypeDB CE latest, 포트 1729 + 8000
  Dockerfile                  # 스키마만 번들하는 얇은 래퍼
scripts/
  typedb-up.sh                # WSL에서 compose up
  typedb-down.sh              # stop (--wipe 로 볼륨 삭제)
  typedb-load.sh              # bun run src/cmd/load.ts 호출 (스키마 + 데이터)
  typedb-query.sh             # ad-hoc HTTP 질의
backend/
  schema.tql                  # TypeDB 3 정의 (attributes / entities / episode relation)
  src/
    domain/types.ts           # Episode / NodeSet 타입
    mock/generator.ts         # 한글 MMORPG 로그 1,000건 생성 (seed 42)
    mock/tql.ts               # 한글 라벨 유지하는 TypeQL insert 블록 빌더
    typedb/client.ts          # HTTP signin + /v1/query 호출, Dataset 조립
    narrative/translate.ts    # 한/영 자연어 → EpisodeFilter → TypeQL + 한글 서사
    cmd/mockgen.ts            # backend/out/{episodes.json, insert.tql} 생성
    cmd/load.ts               # HTTP로 DB 생성·스키마·데이터 적재
    cmd/server.ts             # REST API (/api/health, /api/episodes, /api/stats, /api/query, /api/query/filter, /api/narrative, /api/refresh)
    cmd/querytest.ts          # 4-카테고리 TypeQL 테스트 하니스
apps/web/
  src/
    viz/TemporalScene.tsx     # R3F Canvas + 평면/엔티티/하이퍼엣지 조립
    viz/PlaneLayer.tsx        # 시간 평면 링 + 호버 툴팁
    viz/TimeNode.tsx          # time × player 병합 노드 (토러스+코어)
    viz/EntityMesh.tsx        # entity kind별 지오메트리 + 호버 툴팁
    viz/Hyperedge.tsx         # 삼각팬 메쉬 + cross-boundary perimeter 강조
    viz/layout.ts             # 해시 기반 결정적 xz 배치, tierColorHSL
    ui/StatsPanel.tsx         # Composition 패널 (stats + TypeDB 상태)
    ui/QueryPanel.tsx         # 구조적 필터 + 수동 TypeQL 실행
    ui/NarrativePanel.tsx     # 자연어 입력 + 한글 서사 출력
    App.tsx                   # CSS Grid HUD 구성
docs/html/
  temporal_layers_3d.html     # 시각 언어 참조(배포 안 됨)
```

## 실행 순서

### 0. 의존성

```bash
cd backend   && bun install
cd apps/web  && bun install
```

### 1. TypeDB 기동 (WSL 별도 터미널)

> Docker Desktop 또는 dockerd 필요.

```bash
bash scripts/typedb-up.sh          # typedb/typedb:latest 빌드 + 기동
                                    # 포트 1729 (gRPC) + 8000 (HTTP)
```

종료:

```bash
bash scripts/typedb-down.sh
bash scripts/typedb-down.sh --wipe  # 볼륨까지 삭제
```

### 2. Mock 데이터 생성

```bash
cd backend
bun run src/cmd/mockgen.ts
# backend/out/episodes.json + backend/out/insert.tql (기본 seed=42)
```

현재 1,000건 중 ~18%가 분 경계를, ~3%가 10:00 시간 경계를 횡단합니다.

### 3. TypeDB에 스키마·데이터 적재

```bash
bash scripts/typedb-load.sh         # 실제로는 bun run src/cmd/load.ts 실행
# 최초에는 --reset 권장: bun run src/cmd/load.ts --reset
```

### 4. 4-카테고리 쿼리 테스트 (선택)

```bash
cd backend
bun run src/cmd/querytest.ts
# 7/7 PASS 확인:
#   time-range · entity-touch · cross-boundary · 4-layer 필터
```

### 5. API 서버 + 웹 데브 서버

```bash
# backend/
bun run src/cmd/server.ts          # http://localhost:5174
```

```bash
# apps/web/
bun run dev                        # http://localhost:5173 (/api 프록시됨)
```

브라우저에서 <http://localhost:5173> 열고:

- 상단 좌/우의 헤더·stats
- 좌측 구조 필터(relation_type, activity_type, touches entity, ...)
- 좌하단 자연어 질의: `10:00 이후 던전1 에서 전투`, `중요한 퀘스트`,
  `상인과의 대화` 등 프리셋 지원
- 하단 중앙 spacing/node 슬라이더, 1min/1h 토글

## REST API

| Method · Path | 용도 |
|---|---|
| `GET  /api/health` | dataset 크기 + TypeDB 연결 상태 + data source |
| `GET  /api/episodes` | 전체 `Dataset` (엔티티 카탈로그 + 에피소드) |
| `GET  /api/stats` | 분/시 bucket 카운트 + cross-boundary 총합 |
| `GET  /api/query/filter?...` | 구조 필터 (relation/activity/entity/...) |
| `POST /api/query` `{ tql }` | TypeDB에 직접 TypeQL 실행 |
| `POST /api/narrative` `{ question }` | 자연어 → EpisodeFilter → 서사 + TypeQL 미리보기 |
| `POST /api/refresh` | TypeDB에서 dataset 재 pull |

## 상세 결정 사항

- **TypeDB 2 vs 3**: Node/TS 드라이버 가용성 때문에 한 번 2.28로
  돌렸다가, 사용자 요청에 따라 3.10(latest)로 전환하고 HTTP API를 fetch로
  호출.
- **Go vs Bun**: 원래 백엔드는 Go였지만 호스트/WSL에 Go 미설치 → Bun+TS
  통일. 스크립트/컨테이너만 WSL 의존.
- **복수 문장 적재 문제**: TypeDB 3 HTTP `/v1/query` 는 요청당 최초
  statement만 실행. 로더는 엔티티 1건 = 1 요청, 에피소드 1건 = 1 요청
  으로 직렬 전송 (동시성 8, isolation 충돌 시 skip).
- **Player 병합**: 단일 플레이어이므로 actor role은 각 평면 중심의
  Time×Player 병합 노드에 anchor. 분산 렌더링 제거해 시각 밀도 감소.
- **Cross-boundary 렌더링**: 하이퍼엣지 내부 role 플레이어의 y 좌표를
  `valid_from` · `valid_until`이 걸친 평면 사이에 분산 — 결과는 두/세
  평면을 관통하는 단일 메쉬.
- **색상 saturate 완화**: 중첩 영역이 흰색으로 수렴하는 것을 막기 위해
  mesh 블렌딩을 Additive → Normal로 전환, cross-boundary 전용 additive
  halo만 저 opacity로 유지.
