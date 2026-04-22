import { useState } from "react";

interface CaseResult {
  id: string;
  title: string;
  note: string;
  hyper: { tql: string; count: number; ns_ids: string[]; error?: string };
  triplet: { cypher: string; count: number; error?: string };
  phantom: boolean;
  ratio: string;
}

interface LeakageReport {
  typedb_available: boolean;
  falkor_available: boolean;
  total_hyper: number;
  total_triplet: number;
  total_phantom: number;
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
            <div>phantom <b style={{ color: "var(--accent-red)" }}>{report.total_phantom}</b></div>
          </div>

          <div className="leakage-cases">
            {report.cases.map((c) => (
              <div
                key={c.id}
                className={"leakage-case" + (selectedCaseId === c.id ? " selected" : "") + (c.phantom ? " phantom" : "")}
                onClick={() => highlightCase(c)}
              >
                <div className="leakage-case-title">{c.title}</div>
                <div className="leakage-case-counts">
                  <span title="TypeDB n-ary hyperedge">n-ary <b>{c.hyper.count}</b></span>
                  <span title="FalkorDB triplet">triplet <b>{c.triplet.count}</b></span>
                  <span title="triplet / hyperedge">ratio <b>{c.ratio}×</b></span>
                  {c.phantom && <span className="phantom-tag">PHANTOM</span>}
                </div>
                <div className="leakage-case-note">{c.note}</div>
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
