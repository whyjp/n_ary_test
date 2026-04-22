import { useState } from "react";
import { runLeakageCase } from "../api";

interface Verdict {
  score: number;
  kind: "phantom" | "underrecall" | "exact" | "empty";
  rule_verdict: string;
  llm_verdict?: string;
  judge: "heuristic" | "openai" | "anthropic";
}
interface CaseResult {
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
  verdict?: Verdict;
}

interface LeakageReport {
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

interface Props {
  onHighlight: (nsIds: Set<string> | null) => void;
}

async function runLeakage(): Promise<LeakageReport> {
  const r = await fetch("/api/leakage/run", { method: "GET" });
  return await r.json();
}

export function LeakagePanel({ onHighlight }: Props) {
  const [report, setReport] = useState<LeakageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    try { setReport(await runLeakage()); }
    finally { setLoading(false); }
  }

  function highlightCase(c: CaseResult) {
    setSelectedCaseId(c.id);
    onHighlight(c.hyper.ns_ids.length > 0 ? new Set(c.hyper.ns_ids) : null);
  }

  async function runOne(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    setRunningId(id);
    try {
      const fresh = await runLeakageCase(id);
      if (!fresh || !report) return;
      const updated = {
        ...report,
        cases: report.cases.map((c) => (c.id === id ? (fresh as CaseResult) : c)),
      };
      // recompute totals
      updated.total_hyper       = updated.cases.reduce((a, c) => a + c.hyper.count, 0);
      updated.total_triplet     = updated.cases.reduce((a, c) => a + c.triplet.count, 0);
      updated.total_triplet_hub = updated.cases.reduce((a, c) => a + c.triplet_hub.count, 0);
      updated.total_phantom     = updated.cases.filter((c) => c.phantom).reduce((a, c) => a + c.triplet.count, 0);
      updated.total_phantom_hub = updated.cases.filter((c) => c.hyper.count === 0 && c.triplet_hub.count > 0).reduce((a, c) => a + c.triplet_hub.count, 0);
      const scores = updated.cases.map((c) => c.verdict?.score ?? 0);
      updated.avg_score = scores.length ? Math.round(scores.reduce((a, x) => a + x, 0) / scores.length) : 0;
      setReport(updated);
      setSelectedCaseId(id);
      onHighlight(fresh.hyper.ns_ids.length ? new Set(fresh.hyper.ns_ids) : null);
    } finally { setRunningId(null); }
  }

  return (
    <div className="panel leakage">
      <div className="title-row">Episode boundary · leakage test</div>

      {!report && (
        <>
          <div className="leakage-note">
            같은 1,000 에피소드를 <b>TypeDB n-ary hyperedge</b>와
            {" "}<b>FalkorDB pair-wise triplet</b>에 적재한 뒤, 동일한
            의미 질의를 양쪽에 실행하고 <b>cross-episode phantom 경로</b> 수를
            비교합니다.
          </div>
          <button className="filter-btn" onClick={run} disabled={loading}>
            {loading ? "실행 중…" : "leakage 테스트 실행"}
          </button>
        </>
      )}

      {report && !report.falkor_available && (
        <div className="leakage-warn">
          FalkorDB가 기동되어 있지 않습니다. <code>bash scripts/typedb-up.sh</code> 후
          {" "}<code>bun run src/cmd/load-falkor.ts --reset</code> 실행 필요.
        </div>
      )}

      {report && report.falkor_available && (
        <>
          <div className="leakage-totals">
            <div>hyperedge <b>{report.total_hyper}</b></div>
            <div>triplet <b>{report.total_triplet}</b></div>
            <div title="minute×player hub-scoped triplet">triplet_hub <b style={{ color: "var(--accent-purple)" }}>{report.total_triplet_hub}</b></div>
            <div>phantom <b style={{ color: "var(--accent-red)" }}>{report.total_phantom}</b></div>
            <div title="phantoms surviving after hub constraint">phantom_hub <b style={{ color: "var(--accent-red)" }}>{report.total_phantom_hub}</b></div>
            <div>score <b style={{ color: report.avg_score >= 70 ? "var(--accent-nary)" : "var(--accent-red)" }}>{report.avg_score}/100</b></div>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--text-faint)" }}>judge: {report.judge}</div>
          </div>

          <div className="leakage-cases">
            {report.cases.map((c) => (
              <div
                key={c.id}
                className={"leakage-case" + (selectedCaseId === c.id ? " selected" : "") + (c.phantom ? " phantom" : "")}
                onClick={() => highlightCase(c)}
              >
                <div className="leakage-case-title">
                  <span className={"kind-chip kind-" + c.kind}>{c.kind}</span>
                  {c.title}
                  <button
                    className="case-run-btn"
                    onClick={(e) => void runOne(c.id, e)}
                    disabled={runningId === c.id}
                    title="이 케이스만 재실행"
                  >{runningId === c.id ? "…" : "▷"}</button>
                </div>
                <div className="leakage-case-counts">
                  <span title="TypeDB n-ary hyperedge">n-ary <b>{c.hyper.count}</b></span>
                  <span title="FalkorDB raw pair-wise triplet (no context scope)">triplet <b>{c.triplet.count}</b></span>
                  <span title="FalkorDB (minute×player)-hub-scoped triplet"
                        style={{ color: "var(--accent-purple)" }}>
                    triplet_hub <b>{c.triplet_hub?.count ?? 0}</b>
                  </span>
                  {(c.hub_reduction_pct ?? 0) !== 0 && (
                    <span title="% of naive-triplet phantom eliminated by hub scope"
                          className={"reduction-chip reduction-" + (c.hub_reduction_pct >= 80 ? "ok" : c.hub_reduction_pct >= 30 ? "warn" : "bad")}>
                      hub ↓{c.hub_reduction_pct}%
                    </span>
                  )}
                  <span title="triplet / hyperedge">ratio <b>{c.ratio}×</b></span>
                  {c.verdict && (
                    <span title={c.verdict.rule_verdict}
                          className={"score-chip score-" + (c.verdict.score >= 70 ? "ok" : c.verdict.score >= 30 ? "warn" : "bad")}>
                      {c.verdict.score}/100
                    </span>
                  )}
                  {c.phantom && <span className="phantom-tag">PHANTOM</span>}
                </div>
                <div className="leakage-case-note">{c.note}</div>
                {c.verdict && (
                  <div className="leakage-case-verdict">
                    <b>{c.verdict.kind}</b> · {c.verdict.rule_verdict}
                    {c.verdict.llm_verdict && (
                      <div className="llm-verdict">LLM({c.verdict.judge}): {c.verdict.llm_verdict}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <button className="filter-btn" onClick={run} disabled={loading} style={{ flex: 1 }}>
              {loading ? "재실행…" : "재실행"}
            </button>
            <button className="filter-btn" onClick={() => { setSelectedCaseId(null); onHighlight(null); }}>하이라이트 해제</button>
          </div>
        </>
      )}
    </div>
  );
}
