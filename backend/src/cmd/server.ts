// REST API server — TypeDB is the sole source of truth for episodes.
// There is NO local-file fallback. If TypeDB is unreachable or the database
// hasn't been loaded yet, the API returns 503 and the web viz displays an
// explicit offline state.
//
//   bun run backend/src/cmd/server.ts
//   bun run backend/src/cmd/server.ts --port 5174

import type { Dataset, Episode } from "../domain/types.ts";
import { fetchDataset, runReadQuery, ping } from "../typedb/client.ts";
import { translateAndRun } from "../narrative/translate.ts";
import { runLeakage } from "../leakage/runner.ts";

function flag(name: string, fallback: string): string {
  const i = Bun.argv.indexOf(name);
  return i !== -1 && i + 1 < Bun.argv.length ? Bun.argv[i + 1]! : fallback;
}

const PORT = Number(flag("--port", process.env.PORT ?? "5174"));

// The server keeps an in-memory cache of the dataset but the cache is ALWAYS
// sourced from TypeDB. If TypeDB is unreachable the cache stays empty and
// /api/episodes returns 503 — no local-file fallback.
let cache: { source: "typedb" | "none"; dataset: Dataset | null; loadedAt: number; lastError: string | null } = {
  source: "none", dataset: null, loadedAt: 0, lastError: null,
};

async function refreshCache(): Promise<void> {
  const alive = await ping();
  if (!alive) {
    cache = { source: "none", dataset: null, loadedAt: Date.now(), lastError: "TypeDB not reachable" };
    console.warn(`[refresh] TypeDB not reachable — dataset cache remains empty`);
    return;
  }
  try {
    const ds = await fetchDataset();
    cache = { source: "typedb", dataset: ds, loadedAt: Date.now(), lastError: null };
    console.log(`[refresh] loaded ${ds.episodes.length} episodes from TypeDB`);
  } catch (err) {
    cache = { source: "none", dataset: null, loadedAt: Date.now(), lastError: String(err) };
    console.warn(`[refresh] TypeDB read failed — dataset cache cleared: ${err}`);
  }
}

await refreshCache();

function cors(headers: Headers = new Headers()): Headers {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  return headers;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(new Headers({ "content-type": "application/json" })),
  });
}

function filterEpisodes(list: Episode[], p: URLSearchParams): Episode[] {
  const fm = p.get("fromMinute"); const tm = p.get("toMinute");
  const touch = p.get("touchEntity");
  const crossM = p.get("crossMinute") === "1";
  const crossH = p.get("crossHour") === "1";
  const rel = p.get("relationType");
  const act = p.get("activityType");
  let r = list;
  if (fm)    r = r.filter((e) => e.minute_bucket >= Number(fm));
  if (tm)    r = r.filter((e) => e.minute_bucket <= Number(tm));
  if (touch) r = r.filter((e) => e.roles.some((x) => x.entity_id === touch));
  if (crossM) r = r.filter((e) => e.crosses_minute);
  if (crossH) r = r.filter((e) => e.crosses_hour);
  if (rel)   r = r.filter((e) => e.relation_type === rel);
  if (act)   r = r.filter((e) => e.activity_type === act);
  return r;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    if (url.pathname === "/api/health") {
      const alive = await ping();
      return json({
        ok: cache.source === "typedb" && alive,
        episodes: cache.dataset?.episodes.length ?? 0,
        typedb_available: alive,
        data_source: cache.source,
        loaded_at: cache.loadedAt,
        last_error: cache.lastError,
        window: cache.dataset ? { start: cache.dataset.window_start, end: cache.dataset.window_end } : null,
      });
    }

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      await refreshCache();
      return json({ ok: true, data_source: cache.source, episodes: cache.dataset?.episodes.length ?? 0 });
    }

    if (!cache.dataset) return json({
      error: "no_data_in_typedb",
      typedb_available: await ping(),
      last_error: cache.lastError,
      hint: "bash scripts/typedb-up.sh && bun run src/cmd/mockgen.ts && bun run src/cmd/load.ts --reset, then POST /api/refresh",
    }, 503);

    if (url.pathname === "/api/episodes") return json(cache.dataset);

    if (url.pathname === "/api/stats") {
      const m = new Map<number, number>();
      const h = new Map<number, number>();
      for (const e of cache.dataset.episodes) {
        m.set(e.minute_bucket, (m.get(e.minute_bucket) ?? 0) + 1);
        h.set(e.hour_bucket, (h.get(e.hour_bucket) ?? 0) + 1);
      }
      return json({
        total: cache.dataset.episodes.length,
        minutes: [...m].sort((a, b) => a[0] - b[0]).map(([b, n]) => ({ bucket: b, count: n })),
        hours: [...h].sort((a, b) => a[0] - b[0]).map(([b, n]) => ({ bucket: b, count: n })),
        crosses_minute: cache.dataset.episodes.filter((e) => e.crosses_minute).length,
        crosses_hour: cache.dataset.episodes.filter((e) => e.crosses_hour).length,
      });
    }

    if (url.pathname === "/api/query/filter") {
      const filtered = filterEpisodes(cache.dataset.episodes, url.searchParams);
      return json({ count: filtered.length, episodes: filtered });
    }

    if (url.pathname === "/api/query" && req.method === "POST") {
      const body = await req.json() as { tql?: string };
      if (!body.tql) return json({ error: "missing tql" }, 400);
      const r = await runReadQuery(body.tql);
      return json(r);
    }

    // Cross-episode leakage comparison (TypeDB hyperedge vs FalkorDB triplet).
    if (url.pathname === "/api/leakage/run") {
      const report = await runLeakage();
      return json(report);
    }

    // Natural-language episodic query.
    // body: { question }  ->  { question, tql, filter, matches: Episode[], narrative: string[] }
    if (url.pathname === "/api/narrative" && req.method === "POST") {
      const body = await req.json() as { question?: string };
      if (!body.question) return json({ error: "missing question" }, 400);
      if (!cache.dataset)  return json({ error: "no_data" }, 503);
      const r = translateAndRun(body.question, cache.dataset);
      return json(r);
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
});

console.log(`listening on http://localhost:${PORT}  (source=${cache.source})`);
console.log(`  GET  /api/health`);
console.log(`  GET  /api/episodes`);
console.log(`  GET  /api/stats`);
console.log(`  GET  /api/query/filter?...`);
console.log(`  POST /api/query          { tql }  (TypeDB must be up)`);
console.log(`  POST /api/refresh        (re-pull from TypeDB)`);
