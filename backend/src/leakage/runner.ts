// Runs leakage cases against TypeDB (n_ary) and FalkorDB (n_ary_triplet) and
// returns a structured result suitable for JSON serialisation to the web UI.

import { cases, type LeakageCase } from "./cases.ts";
import { graphQuery, answerCount, ping as falkorPing } from "../falkor/client.ts";
import { judgeCase, type Verdict } from "./judge.ts";

const TYPEDB_HTTP = process.env.TYPEDB_HTTP ?? "http://localhost:28000";
const TYPEDB_DB   = process.env.TYPEDB_DATABASE ?? "n_ary";
const TYPEDB_USER = process.env.TYPEDB_USER ?? "admin";
const TYPEDB_PASS = process.env.TYPEDB_PASSWORD ?? "password";
const FALKOR_GRAPH = process.env.FALKOR_GRAPH ?? "n_ary_triplet";

export interface CaseResult {
  id: string;
  title: string;
  note: string;
  kind: LeakageCase["kind"];
  hyper: { tql: string; count: number; ns_ids: string[]; error?: string };
  triplet: { cypher: string; count: number; error?: string };
  triplet_hub: { cypher: string; count: number; error?: string };
  phantom: boolean;
  ratio: string;
  hub_ratio: string;              // triplet_hub / hyper (∞ when hub>0 and hyper=0)
  hub_reduction_pct: number;      // percent reduction in phantom vs naive triplet
  verdict?: Verdict;
}

export interface LeakageReport {
  typedb_available: boolean;
  falkor_available: boolean;
  total_hyper: number;
  total_triplet: number;
  total_triplet_hub: number;
  total_phantom: number;
  total_phantom_hub: number;
  avg_score: number;
  judge: "heuristic" | "openai" | "anthropic";
  cases: CaseResult[];
}

async function typedbToken(): Promise<string> {
  const r = await fetch(`${TYPEDB_HTTP}/v1/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TYPEDB_USER, password: TYPEDB_PASS }),
  });
  if (!r.ok) throw new Error(`typedb signin ${r.status}`);
  return ((await r.json()) as any).token;
}

async function typedbNsIds(token: string, tql: string): Promise<{ ids: string[]; error?: string }> {
  const r = await fetch(`${TYPEDB_HTTP}/v1/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ databaseName: TYPEDB_DB, query: tql, transactionType: "read", commit: false }),
  });
  if (!r.ok) return { ids: [], error: `${r.status} ${(await r.text()).slice(0, 120)}` };
  const body = (await r.json()) as { answers: any[] | null };
  const ids: string[] = [];
  for (const a of body.answers ?? []) {
    const ns = a?.data?.ns;
    const v = ns?.value;
    if (typeof v === "string") ids.push(v);
  }
  return { ids };
}

async function tripletCount(cypher: string): Promise<{ count: number; error?: string }> {
  try {
    const res = await graphQuery(FALKOR_GRAPH, cypher);
    return { count: answerCount(res) };
  } catch (e) {
    return { count: 0, error: String(e).slice(0, 140) };
  }
}

async function typedbAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${TYPEDB_HTTP}/`);
    return r.ok || r.status === 307;
  } catch {
    return false;
  }
}

async function runOne(tok: string, spec: LeakageCase): Promise<CaseResult> {
  const [h, t, hub] = await Promise.all([
    typedbNsIds(tok, spec.hyper),
    tripletCount(spec.triplet),
    tripletCount(spec.triplet_hub),
  ]);
  const phantom = h.ids.length === 0 && t.count > 0;
  // Phantom reduction: how much of the naive-triplet phantom the hub tier
  // eliminates. 100% = hub matches n-ary exactly; 0% = hub = naive triplet.
  const naivePhantom = Math.max(0, t.count - h.ids.length);
  const hubPhantom   = Math.max(0, hub.count - h.ids.length);
  const hubReduction = naivePhantom === 0 ? 0 : Math.round(((naivePhantom - hubPhantom) / naivePhantom) * 100);
  const base: CaseResult = {
    id: spec.id,
    title: spec.title,
    note: spec.note,
    kind: spec.kind,
    hyper:       { tql: spec.hyper,   count: h.ids.length, ns_ids: h.ids, error: h.error },
    triplet:     { cypher: spec.triplet, count: t.count, error: t.error },
    triplet_hub: { cypher: spec.triplet_hub, count: hub.count, error: hub.error },
    phantom,
    ratio:     h.ids.length === 0 ? (t.count   === 0 ? "—" : "∞") : (t.count / h.ids.length).toFixed(2),
    hub_ratio: h.ids.length === 0 ? (hub.count === 0 ? "—" : "∞") : (hub.count / h.ids.length).toFixed(2),
    hub_reduction_pct: hubReduction,
  };
  base.verdict = await judgeCase(base, spec);
  return base;
}

// Run a single case by id. Returns null if the id is unknown or databases
// are unreachable.
export async function runCase(id: string): Promise<CaseResult | null> {
  const spec = cases.find((c) => c.id === id);
  if (!spec) return null;
  const [typedbAv, falkorAv] = await Promise.all([typedbAlive(), falkorPing()]);
  if (!typedbAv || !falkorAv) return null;
  const tok = await typedbToken();
  return await runOne(tok, spec);
}

export async function runLeakage(): Promise<LeakageReport> {
  const [typedbAv, falkorAv] = await Promise.all([typedbAlive(), falkorPing()]);
  const report: LeakageReport = {
    typedb_available: typedbAv,
    falkor_available: falkorAv,
    total_hyper: 0, total_triplet: 0, total_triplet_hub: 0,
    total_phantom: 0, total_phantom_hub: 0,
    avg_score: 0,
    judge: (process.env.LLM_JUDGE?.toLowerCase() as any) ?? "heuristic",
    cases: [],
  };
  if (!typedbAv || !falkorAv) return report;

  const tok = await typedbToken();
  for (const spec of cases) {
    const result = await runOne(tok, spec);
    report.cases.push(result);
    report.total_hyper += result.hyper.count;
    report.total_triplet += result.triplet.count;
    report.total_triplet_hub += result.triplet_hub.count;
    if (result.phantom) report.total_phantom += result.triplet.count;
    if (result.hyper.count === 0 && result.triplet_hub.count > 0) {
      report.total_phantom_hub += result.triplet_hub.count;
    }
  }
  report.avg_score = report.cases.length
    ? Math.round(report.cases.reduce((a, c) => a + (c.verdict?.score ?? 0), 0) / report.cases.length)
    : 0;
  // Report judge: if any case got an LLM verdict, use that as reported judge.
  const anyLLM = report.cases.find((c) => c.verdict?.judge && c.verdict.judge !== "heuristic");
  report.judge = (anyLLM?.verdict?.judge ?? "heuristic") as LeakageReport["judge"];
  return report;
}

export type { LeakageCase };
