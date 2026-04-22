# n_ary_test — temporal hyperedges / NodeSet viz + TypeDB query test

Visualises a time-batched hyper-relational MMORPG event stream and verifies the
same dataset is queryable from a TypeDB 3.x graph database.

The data model follows **hyper-triplet v5 / my-own-test-design-spec** (see
`D:/github/gr-test/docs/hyper-triplet-implementation-plan-v5.md` for the
theory). Each log line is an atomic *NodeSet* / hyperedge:

| Layer | Owned by `episode` relation | Example |
|---|---|---|
| L0 — fact | `relation_type` + role players | `kill_mob(actor=P1, mob_target=M3, at_location=L3)` |
| L1 — temporal / importance | `event_time`, `minute_bucket`, `hour_bucket`, `valid_from/until`, `importance`, `belief` | `importance=0.72`, spans 09:59:40 → 10:00:02 |
| L2 — context | `activity_type`, `mood` | `combat / aggressive` |
| L3 — auxiliary | `community_id`, `source_ref` | `c_combat_L3`, `kafka://events/412` |

Time and field are first-class — every log carries a `valid_from / valid_until`
and an open-ended `fields` bag inside `raw_log`. Episodes that span more than
one minute bucket get `crosses_minute=true`; episodes that straddle the
10:00 clock-hour boundary get `crosses_hour=true`.

## Visualisation

Two interchangeable 3D views, toggled from the bottom control bar.

- **1min · 60 planes** — each 1-minute bucket becomes one horizontal slab,
  stacked vertically across the 09:30—10:30 window.
- **1h · 2 planes** — aggregates into two hour-aligned slabs (09:00—10:00 and
  10:00—11:00, each partly filled).

Cross-boundary hyperedges are rendered as a **single mesh piercing the
planes**: role players appear at different `y` positions according to the
episode's `valid_from / valid_until`, producing a tilted prism instead of a
flat polygon.

Stable entity positions mean the same player / npc / location always sits at
the same `(x, z)` coordinate across every plane — so the dashed vertical
"entity tracks" in the hour view highlight entities that reappear over time.

## Stack

| Layer | Tech | Why |
|---|---|---|
| Graph DB | **TypeDB 3.x** (docker-compose, WSL) | n-ary relations with role cardinality + typed attributes |
| Backend | **Bun + TypeScript** | REST API + mock generator + TypeDB console shell-out |
| Frontend | **Vite + React + React-Three-Fiber** (bun pkg mgr) | 3D viz, same visual language as `docs/html/temporal_layers_3d.html` |
| Scripts | **bash** | run from a separate WSL terminal |

Go was the original backend choice but is not installed on the host/WSL. Bun
keeps everything on one toolchain.

## Repository layout

```
docker/
  docker-compose.yml   # typedb/typedb:3.2.0
  Dockerfile           # thin wrapper baking schema.tql
scripts/
  typedb-up.sh         # build + start TypeDB in WSL
  typedb-down.sh       # stop (optional --wipe to drop the volume)
  typedb-load.sh       # create database, load schema, load insert.tql
  typedb-query.sh      # ad-hoc "typedb console" read query
backend/
  schema.tql           # TypeDB 3.x schema (the single source of truth)
  src/
    domain/types.ts
    mock/generator.ts  # deterministic 1000-episode stream
    mock/tql.ts        # turns the dataset into TypeQL inserts
    typedb/client.ts   # docker exec -> typedb console wrapper
    cmd/mockgen.ts     # writes backend/out/{episodes.json, insert.tql}
    cmd/server.ts      # REST API (serves dataset, proxies TypeQL queries)
    cmd/querytest.ts   # 4-category TypeDB query test harness
apps/web/
  src/
    viz/               # TemporalScene, PlaneLayer, Hyperedge, EntityMesh
    ui/                # StatsPanel, QueryPanel
    App.tsx
docs/html/
  temporal_layers_3d.html   # kept as visual reference (not built or deployed)
```

## Run — step by step

All commands run from the repo root unless noted.

### 0. Install dependencies

```bash
cd backend && bun install
cd ../apps/web && bun install
```

### 1. Start TypeDB (separate WSL terminal)

> In WSL — TypeDB runs in a Docker container, so Docker Desktop or dockerd must
> be running. These scripts use `docker compose` (v2 plugin).

```bash
bash scripts/typedb-up.sh      # builds n_ary_test/typedb:3 and launches it
```

Leave this terminal alone. When you're done:

```bash
bash scripts/typedb-down.sh            # stop (keeps data volume)
bash scripts/typedb-down.sh --wipe     # stop + drop volume
```

### 2. Generate the mock dataset

```bash
cd backend
bun run src/cmd/mockgen.ts          # writes backend/out/episodes.json + insert.tql
```

Deterministic seed (`42` by default). Seed=42 currently yields:
- 1 000 episodes across the 09:30—10:30 UTC window
- ~182 episodes (~18%) span a minute boundary
- ~33 episodes (~3%) straddle the 10:00 hour boundary
- 12 distinct `relation_type`s (login, chat_npc, trade, kill_mob, duel, …)

### 3. Load schema + data into TypeDB (WSL terminal)

```bash
bash scripts/typedb-load.sh
```

This recreates the `n_ary` database, applies `backend/schema.tql`, then sources
`backend/out/insert.tql`.

### 4. Run the query-test harness

```bash
cd backend
bun run src/cmd/querytest.ts
```

The harness probes four query categories and prints PASS/FAIL per assertion:

1. **time-range** — episodes inside a given `minute_bucket` range
2. **entity-touch** — episodes touching a specific player / npc via role
3. **cross-boundary** — `crosses_minute = true` / `crosses_hour = true`
4. **4-layer filter** — combined L1 (`importance`) + L2 (`activity_type`) + L3
   (`community_id`) + L0 (role player) predicates

### 5. Start the API + web dev server

```bash
# in backend/
bun run src/cmd/server.ts        # listens on http://localhost:5174
```

```bash
# in apps/web/
bun run dev                      # http://localhost:5173 with /api proxy
```

Open <http://localhost:5173> — the 3D view loads, toggle between 1-min and
1-hour planes, apply client-side filters, and from the Query panel run ad-hoc
TypeQL against the live TypeDB container.

## REST API

| Method + path | Purpose |
|---|---|
| `GET  /api/health` | Dataset size + whether TypeDB container is reachable |
| `GET  /api/episodes` | Full `Dataset` (entity catalogues + all episodes) |
| `GET  /api/stats` | Per-minute and per-hour bucket counts + cross-boundary totals |
| `GET  /api/query/filter?relationType=…&touchEntity=…&crossHour=1&…` | Client-side filter helper |
| `POST /api/query` | `{ tql, mode }` — forwards a TypeQL read query through `docker exec` |

## Notes

- The reference HTML at `docs/html/temporal_layers_3d.html` is kept as a
  visual-language reference — the React/R3F port mirrors its colour ramps,
  slab boundaries, triangle-fan hyperedges, and JetBrains-Mono labelling.
- `crosses_minute` ends up ~18% rather than the nominal 9% target because the
  generator uses a single RNG roll that can select either cross-minute *or*
  cross-hour, and the cross-hour branch also produces minute-crossing
  episodes — net effect is higher minute-boundary density, which is great
  for exercising the single-mesh-piercing-planes rendering.
