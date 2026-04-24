// Storage + latency benchmark.
//
//   storage — approximated from the generated dataset + FalkorDB graph stats.
//             TypeDB n-ary explodes because each episode owns 15 L1/L2/L3
//             attributes AND contributes role bindings; FalkorDB dedupes
//             pair-wise edges so its storage footprint stays small but
//             cannot express episode boundary.
//   latency — each case's TypeQL + Cypher query is run N times and the
//             median wall-clock is reported per DB.

import { cases, type LeakageCase } from "./cases.ts";
import { graphQuery, ping as falkorPing } from "../falkor/client.ts";
import type { Dataset } from "../domain/types.ts";

const TYPEDB_HTTP = process.env.TYPEDB_HTTP ?? "http://localhost:28000";
const TYPEDB_DB   = process.env.TYPEDB_DATABASE ?? "n_ary";
const TYPEDB_USER = process.env.TYPEDB_USER ?? "admin";
const TYPEDB_PASS = process.env.TYPEDB_PASSWORD ?? "password";
const FALKOR_GRAPH = process.env.FALKOR_GRAPH ?? "n_ary_triplet";

const EPISODE_OWNED_ATTRS = 15;  // owned by every episode per schema.tql

async function typedbToken(): Promise<string> {
  const r = await fetch(`${TYPEDB_HTTP}/v1/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TYPEDB_USER, password: TYPEDB_PASS }),
  });
  return ((await r.json()) as any).token;
}

async function timedTypedb(token: string, tql: string): Promise<number> {
  const t0 = performance.now();
  await fetch(`${TYPEDB_HTTP}/v1/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ databaseName: TYPEDB_DB, query: tql, transactionType: "read", commit: false }),
  });
  return performance.now() - t0;
}

async function timedFalkor(cypher: string): Promise<number> {
  const t0 = performance.now();
  await graphQuery(FALKOR_GRAPH, cypher);
  return performance.now() - t0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface StorageReport {
  typedb: {
    episodes: number;
    role_bindings: number;
    attribute_bindings: number;
    entity_instances: number;
    total_records: number;
  };
  falkor: {
    nodes: number;
    edges: number;
    total_records: number;
  };
  blowup_ratio: number;
}

export interface LatencyCaseReport {
  id: string;
  title: string;
  kind: LeakageCase["kind"];
  hyper_ms_median: number;
  triplet_ms_median: number;
  triplet_hub_ms_median: number;
  hyper_ms_samples: number[];
  triplet_ms_samples: number[];
  triplet_hub_ms_samples: number[];
}

export interface BenchmarkReport {
  iterations: number;
  storage: StorageReport;
  latency: LatencyCaseReport[];
  totals: { hyper_ms_median: number; triplet_ms_median: number; triplet_hub_ms_median: number };
  stale: boolean; // true if datasets are unreachable
}

export function computeStorage(ds: Dataset, falkor: { nodes: number; edges: number }): StorageReport {
  const episodes = ds.episodes.length;
  const roleBindings = ds.episodes.reduce((a, e) => a + e.roles.length, 0);
  const attributeBindings = episodes * EPISODE_OWNED_ATTRS;
  const entityInstances = ds.players.length + ds.devices.length + ds.locations.length
    + ds.npcs.length + ds.mobs.length + ds.items.length;
  // TypeDB "record" count: attribute instances (deduped by value) are not
  // proper per-episode records in practice, but they're real storage. We
  // report them explicitly and use the coarse total (episodes + roles +
  // attrs + entities) as the comparison baseline.
  const typedbTotal = episodes + roleBindings + attributeBindings + entityInstances;
  // FalkorDB now stores Episode as a reified node AND every role binding as
  // an edge — same logical content as TypeDB. The blowup ratio reflects
  // TypeDB's attribute-binding overhead vs FalkorDB's flatter node props.
  const falkorTotal = falkor.nodes + falkor.edges;
  return {
    typedb: {
      episodes,
      role_bindings: roleBindings,
      attribute_bindings: attributeBindings,
      entity_instances: entityInstances,
      total_records: typedbTotal,
    },
    falkor: { nodes: falkor.nodes, edges: falkor.edges, total_records: falkorTotal },
    blowup_ratio: falkorTotal ? typedbTotal / falkorTotal : 0,
  };
}

export async function runBenchmark(
  ds: Dataset,
  falkorGraph: { nodes: number; edges: number },
  iterations = 5,
): Promise<BenchmarkReport> {
  const storage = computeStorage(ds, falkorGraph);
  const falkorAv = await falkorPing();
  if (!falkorAv) {
    return {
      iterations,
      storage,
      latency: [],
      totals: { hyper_ms_median: 0, triplet_ms_median: 0, triplet_hub_ms_median: 0 },
      stale: true,
    };
  }

  const token = await typedbToken();
  const latency: LatencyCaseReport[] = [];
  for (const c of cases) {
    const hyperSamples: number[] = [];
    const tripletSamples: number[] = [];
    const tripletHubSamples: number[] = [];
    // First call warms caches; we still sample it but it's usually the
    // slowest — the median over ≥3 samples squashes that.
    for (let i = 0; i < iterations; i++) {
      try { hyperSamples.push(await timedTypedb(token, c.hyper)); } catch {}
      try { tripletSamples.push(await timedFalkor(c.triplet)); } catch {}
      try { tripletHubSamples.push(await timedFalkor(c.triplet_hub)); } catch {}
    }
    latency.push({
      id: c.id,
      title: c.title,
      kind: c.kind,
      hyper_ms_median: Math.round(median(hyperSamples) * 100) / 100,
      triplet_ms_median: Math.round(median(tripletSamples) * 100) / 100,
      triplet_hub_ms_median: Math.round(median(tripletHubSamples) * 100) / 100,
      hyper_ms_samples: hyperSamples.map((v) => Math.round(v * 100) / 100),
      triplet_ms_samples: tripletSamples.map((v) => Math.round(v * 100) / 100),
      triplet_hub_ms_samples: tripletHubSamples.map((v) => Math.round(v * 100) / 100),
    });
  }

  const totals = {
    hyper_ms_median:       Math.round(median(latency.map((l) => l.hyper_ms_median)) * 100) / 100,
    triplet_ms_median:     Math.round(median(latency.map((l) => l.triplet_ms_median)) * 100) / 100,
    triplet_hub_ms_median: Math.round(median(latency.map((l) => l.triplet_hub_ms_median)) * 100) / 100,
  };
  return { iterations, storage, latency, totals, stale: false };
}
