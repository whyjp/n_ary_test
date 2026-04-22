import type { Dataset } from "./types";

export async function fetchDataset(): Promise<Dataset> {
  const res = await fetch("/api/episodes");
  if (!res.ok) throw new Error(`GET /api/episodes -> ${res.status}`);
  return (await res.json()) as Dataset;
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  episodes: number;
  typedb_available: boolean;
  data_source: "typedb" | "fallback" | "none";
}> {
  const res = await fetch("/api/health");
  return await res.json();
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
