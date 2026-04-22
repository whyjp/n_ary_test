// Runs leakage cases against TypeDB (n_ary) and FalkorDB (n_ary_triplet) and
// returns a structured result suitable for JSON serialisation to the web UI.

import { cases, type LeakageCase } from "./cases.ts";
import { graphQuery, answerCount, ping as falkorPing } from "../falkor/client.ts";

const TYPEDB_HTTP = process.env.TYPEDB_HTTP ?? "http://localhost:8000";
const TYPEDB_DB   = process.env.TYPEDB_DATABASE ?? "n_ary";
const TYPEDB_USER = process.env.TYPEDB_USER ?? "admin";
const TYPEDB_PASS = process.env.TYPEDB_PASSWORD ?? "password";
const FALKOR_GRAPH = process.env.FALKOR_GRAPH ?? "n_ary_triplet";

export interface CaseResult {
  id: string;
  title: string;
  note: string;
  hyper: { tql: string; count: number; ns_ids: string[]; error?: string };
  triplet: { cypher: string; count: number; error?: string };
  phantom: boolean;
  ratio: string;
}

export interface LeakageReport {
  typedb_available: boolean;
  falkor_available: boolean;
  total_hyper: number;
  total_triplet: number;
  total_phantom: number;
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

export async function runLeakage(): Promise<LeakageReport> {
  const [typedbAv, falkorAv] = await Promise.all([typedbAlive(), falkorPing()]);
  const report: LeakageReport = {
    typedb_available: typedbAv,
    falkor_available: falkorAv,
    total_hyper: 0, total_triplet: 0, total_phantom: 0,
    cases: [],
  };
  if (!typedbAv || !falkorAv) return report;

  const tok = await typedbToken();
  for (const c of cases) {
    const [h, t] = await Promise.all([typedbNsIds(tok, c.hyper), tripletCount(c.triplet)]);
    const phantom = h.ids.length === 0 && t.count > 0;
    report.cases.push({
      id: c.id,
      title: c.title,
      note: c.note,
      hyper:   { tql: c.hyper,   count: h.ids.length, ns_ids: h.ids, error: h.error },
      triplet: { cypher: c.triplet, count: t.count, error: t.error },
      phantom,
      ratio: h.ids.length === 0 ? (t.count === 0 ? "—" : "∞") : (t.count / h.ids.length).toFixed(2),
    });
    report.total_hyper += h.ids.length;
    report.total_triplet += t.count;
    if (phantom) report.total_phantom += t.count;
  }
  return report;
}

export type { LeakageCase };
