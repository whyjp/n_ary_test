import type { Dataset } from "./types";

export async function fetchDataset(): Promise<Dataset> {
  const res = await fetch("/api/episodes");
  if (res.status === 503) {
    const body = await res.json() as { error: string; last_error?: string; hint?: string };
    throw new Error(
      `TypeDB unavailable — ${body.last_error ?? body.error}` +
      (body.hint ? `\n\n${body.hint}` : ""),
    );
  }
  if (!res.ok) throw new Error(`GET /api/episodes -> ${res.status}`);
  return (await res.json()) as Dataset;
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  episodes: number;
  typedb_available: boolean;
  falkor_available: boolean;
  data_source: "typedb" | "none";
  last_error: string | null;
}> {
  const res = await fetch("/api/health");
  return await res.json();
}

export interface BenchmarkInfo {
  typedb: {
    alive: boolean;
    database: string;
    episodes: number;
    entities: number;
    cross_minute: number;
    cross_hour: number;
    window: { start: string; end: string } | null;
  };
  falkor: {
    alive: boolean;
    graph: string;
    nodes: number;
    edges: number;
  };
  relation_counts: Record<string, number>;
  activity_counts: Record<string, number>;
  leakage: {
    cases: number;
    total_hyper: number;
    total_triplet: number;
    total_triplet_hub: number;
    total_phantom: number;
    total_phantom_hub: number;
    phantom_cases: number;
  } | null;
}

export async function fetchBenchmarkInfo(): Promise<BenchmarkInfo> {
  const res = await fetch("/api/benchmark-info");
  if (!res.ok) {
    return {
      typedb: { alive: false, database: "—", episodes: 0, entities: 0, cross_minute: 0, cross_hour: 0, window: null },
      falkor: { alive: false, graph: "—", nodes: 0, edges: 0 },
      relation_counts: {},
      activity_counts: {},
      leakage: null,
    };
  }
  return await res.json();
}

export interface FalkorGraphNode { id: string; label: string }
export interface FalkorGraphEdge { type: string; src: string; dst: string; srcLabel: string; dstLabel: string }
export interface FalkorGraphResponse {
  nodes: FalkorGraphNode[];
  edges: FalkorGraphEdge[];
  falkor_available: boolean;
}

export interface CaseResultResponse {
  id: string;
  title: string;
  note: string;
  kind: "co_occur" | "multi_hop" | "cardinality";
  hyper: { tql: string; count: number; ns_ids: string[]; error?: string };
  triplet: { cypher: string; count: number; error?: string };
  triplet_hub: { cypher: string; count: number; error?: string };
  phantom: boolean;
  ratio: string;
  hub_ratio: string;
  hub_reduction_pct: number;
  verdict?: {
    score: number;
    kind: "phantom" | "underrecall" | "exact" | "empty";
    rule_verdict: string;
    llm_verdict?: string;
    judge: "heuristic" | "openai" | "anthropic";
  };
}

export async function runLeakageCase(id: string): Promise<CaseResultResponse | null> {
  const res = await fetch("/api/leakage/run-case", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) return null;
  return await res.json();
}

export interface BenchmarkReport {
  iterations: number;
  storage: {
    typedb: { episodes: number; role_bindings: number; attribute_bindings: number;
              entity_instances: number; total_records: number };
    falkor: { nodes: number; edges: number; total_records: number };
    blowup_ratio: number;
  };
  latency: Array<{
    id: string; title: string; kind: "co_occur" | "multi_hop" | "cardinality";
    hyper_ms_median: number; triplet_ms_median: number; triplet_hub_ms_median: number;
    hyper_ms_samples: number[]; triplet_ms_samples: number[]; triplet_hub_ms_samples: number[];
  }>;
  totals: { hyper_ms_median: number; triplet_ms_median: number; triplet_hub_ms_median: number };
  stale: boolean;
}

export async function fetchBenchmark(iter = 5): Promise<BenchmarkReport> {
  const res = await fetch(`/api/benchmark?iter=${iter}`);
  return await res.json();
}

export async function fetchFalkorGraph(): Promise<FalkorGraphResponse> {
  try {
    const res = await fetch("/api/falkor-graph");
    if (!res.ok) return { nodes: [], edges: [], falkor_available: false };
    const body = await res.json();
    return {
      nodes: Array.isArray(body?.nodes) ? body.nodes : [],
      edges: Array.isArray(body?.edges) ? body.edges : [],
      falkor_available: Boolean(body?.falkor_available ?? (Array.isArray(body?.nodes) && body.nodes.length > 0)),
    };
  } catch {
    return { nodes: [], edges: [], falkor_available: false };
  }
}

export async function refreshServer(): Promise<{ ok: boolean; data_source: string; episodes: number }> {
  const res = await fetch("/api/refresh", { method: "POST" });
  return await res.json();
}

export interface NarrativeResponse {
  question: string;
  tql: string;
  filter: Record<string, unknown>;
  matches: Array<{ ns_id: string }>;
  narrative: string[];
  error?: string;
}

export async function askNarrative(question: string): Promise<NarrativeResponse> {
  const res = await fetch("/api/narrative", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return await res.json();
}

export async function runTypeqlQuery(tql: string): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  answers: number;
}> {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tql, mode: "read" }),
  });
  return await res.json();
}
