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
import { runLeakage, runCase } from "../leakage/runner.ts";
import { runBenchmark, computeStorage } from "../leakage/benchmark.ts";
import { graphStats, graphDump, ping as falkorPing } from "../falkor/client.ts";

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
      const [alive, falkorAlive] = await Promise.all([ping(), falkorPing()]);
      return json({
        ok: cache.source === "typedb" && alive,
        episodes: cache.dataset?.episodes.length ?? 0,
        typedb_available: alive,
        falkor_available: falkorAlive,
        data_source: cache.source,
        loaded_at: cache.loadedAt,
        last_error: cache.lastError,
        window: cache.dataset ? { start: cache.dataset.window_start, end: cache.dataset.window_end } : null,
      });
    }

    // Aggregate benchmark summary — powers the FE infographic.
    if (url.pathname === "/api/benchmark-info") {
      const ds = cache.dataset;
      const [typedbAlive, falkorAlive] = await Promise.all([ping(), falkorPing()]);
      const falkor = falkorAlive
        ? await graphStats(process.env.FALKOR_GRAPH ?? "n_ary_triplet")
        : { nodes: 0, edges: 0 };

      const relCounts: Record<string, number> = {};
      const actCounts: Record<string, number> = {};
      if (ds) {
        for (const e of ds.episodes) {
          relCounts[e.relation_type] = (relCounts[e.relation_type] ?? 0) + 1;
          actCounts[e.activity_type] = (actCounts[e.activity_type] ?? 0) + 1;
        }
      }

      // Run leakage only if both DBs are up — it's a couple of round-trips.
      let leakage: Awaited<ReturnType<typeof runLeakage>> | null = null;
      if (typedbAlive && falkorAlive) {
        try { leakage = await runLeakage(); } catch { leakage = null; }
      }

      const entityCount = ds
        ? ds.players.length + ds.devices.length + ds.locations.length + ds.npcs.length + ds.mobs.length + ds.items.length
        : 0;

      return json({
        typedb: {
          alive: typedbAlive,
          database: process.env.TYPEDB_DATABASE ?? "n_ary",
          episodes: ds?.episodes.length ?? 0,
          entities: entityCount,
          cross_minute: ds?.episodes.filter((e) => e.crosses_minute).length ?? 0,
          cross_hour: ds?.episodes.filter((e) => e.crosses_hour).length ?? 0,
          window: ds ? { start: ds.window_start, end: ds.window_end } : null,
        },
        falkor: {
          alive: falkorAlive,
          graph: process.env.FALKOR_GRAPH ?? "n_ary_triplet",
          nodes: falkor.nodes,
          edges: falkor.edges,
        },
        relation_counts: relCounts,
        activity_counts: actCounts,
        leakage: leakage ? {
          cases: leakage.cases.length,
          total_hyper: leakage.total_hyper,
          total_triplet: leakage.total_triplet,
          total_triplet_hub: leakage.total_triplet_hub,
          total_phantom: leakage.total_phantom,
          total_phantom_hub: leakage.total_phantom_hub,
          phantom_cases: leakage.cases.filter((c) => c.phantom).length,
        } : null,
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

    // Full pair-wise triplet graph for the alternate 3D view.
    // Cap edges so the wire payload is sane — full reified graph has thousands.
    if (url.pathname === "/api/falkor-graph") {
      if (!(await falkorPing())) return json({ nodes: [], edges: [], falkor_available: false }, 503);
      const maxEdges = Number(url.searchParams.get("maxEdges") ?? "1500");
      const dump = await graphDump(process.env.FALKOR_GRAPH ?? "n_ary_triplet", { maxEdges });
      return json({ ...dump, falkor_available: true, edge_limit: maxEdges });
    }

    // Cross-episode leakage comparison (TypeDB hyperedge vs FalkorDB triplet).
    if (url.pathname === "/api/leakage/run") {
      const report = await runLeakage();
      return json(report);
    }

    // Run a single leakage case by id.
    if (url.pathname === "/api/leakage/run-case" && req.method === "POST") {
      const body = await req.json() as { id?: string };
      if (!body.id) return json({ error: "missing id" }, 400);
      const result = await runCase(body.id);
      if (!result) return json({ error: "unknown_case_or_db_unreachable" }, 404);
      return json(result);
    }

    // Storage + latency benchmark — triggers real query rounds.
    if (url.pathname === "/api/benchmark") {
      if (!cache.dataset) return json({ error: "no_data_in_typedb" }, 503);
      const falkorGraph = (await falkorPing())
        ? await graphStats(process.env.FALKOR_GRAPH ?? "n_ary_triplet")
        : { nodes: 0, edges: 0 };
      const iter = Number(url.searchParams.get("iter") ?? "5");
      const report = await runBenchmark(cache.dataset, falkorGraph, iter);
      return json(report);
    }

    // Cheap storage-only summary (no query rounds).
    if (url.pathname === "/api/benchmark/storage") {
      if (!cache.dataset) return json({ error: "no_data_in_typedb" }, 503);
      const falkorGraph = (await falkorPing())
        ? await graphStats(process.env.FALKOR_GRAPH ?? "n_ary_triplet")
        : { nodes: 0, edges: 0 };
      return json(computeStorage(cache.dataset, falkorGraph));
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
