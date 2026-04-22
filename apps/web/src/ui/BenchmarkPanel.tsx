import { useState } from "react";
import { fetchBenchmark, type BenchmarkReport } from "../api";

export function BenchmarkPanel() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(iter: number) {
    setLoading(true);
    try { setReport(await fetchBenchmark(iter)); }
    finally { setLoading(false); }
  }

  return (
    <div className="panel benchmark">
      <div className="title-row">저장 · 쿼리 비용 벤치마크</div>

      {!report && (
        <>
          <div className="benchmark-note">
            n-ary hyperedge는 에피소드 경계를 보존하느라 <b>레코드 수가 폭발</b>합니다 —
            이는 의도된 트레이드오프. 아래 버튼으로 실제 TypeDB vs FalkorDB의
            저장 단위 수와 동일 질의의 쿼리 지연을 측정합니다.
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="filter-btn" onClick={() => run(3)} disabled={loading}>
              {loading ? "측정 중…" : "3 iter"}
            </button>
            <button className="filter-btn" onClick={() => run(5)} disabled={loading}>5 iter</button>
            <button className="filter-btn" onClick={() => run(10)} disabled={loading}>10 iter</button>
          </div>
        </>
      )}

      {report && (
        <>
          <div className="bench-storage">
            <div className="bench-storage-head">storage cost (records)</div>
            <div className="bench-row">
              <span className="bar-label">hyperedge</span>
              <div className="bar"><div className="bar-fill hyper"
                style={{ width: `${100}%` }} /></div>
              <span className="bar-val">{report.storage.typedb.total_records.toLocaleString()}</span>
            </div>
            <div className="bench-row">
              <span className="bar-label">triplet</span>
              <div className="bar"><div className="bar-fill triplet"
                style={{ width: `${(report.storage.falkor.total_records / Math.max(report.storage.typedb.total_records,1)) * 100}%` }} /></div>
              <span className="bar-val">{report.storage.falkor.total_records.toLocaleString()}</span>
            </div>
            <div className="bench-blowup">
              blowup <b>{report.storage.blowup_ratio.toFixed(1)}×</b> · episodes <b>{report.storage.typedb.episodes}</b>
              {" · "}role bindings <b>{report.storage.typedb.role_bindings}</b>
              {" · "}attr bindings <b>{report.storage.typedb.attribute_bindings.toLocaleString()}</b>
              {" | "}triplet nodes <b>{report.storage.falkor.nodes}</b>
              {" · "}edges <b>{report.storage.falkor.edges}</b>
            </div>
          </div>

          <div className="bench-latency">
            <div className="bench-storage-head">query latency (median ms, {report.iterations} iter)</div>
            {report.latency.map((l) => {
              const hubMs = l.triplet_hub_ms_median ?? 0;
              const peak = Math.max(l.hyper_ms_median, l.triplet_ms_median, hubMs, 1);
              const hyperPct = Math.min(100, (l.hyper_ms_median / peak) * 100);
              const tripletPct = Math.min(100, (l.triplet_ms_median / peak) * 100);
              const hubPct = Math.min(100, (hubMs / peak) * 100);
              return (
                <div key={l.id} className="bench-lat-case">
                  <div className="bench-lat-title">
                    <span className={"kind-chip kind-" + l.kind}>{l.kind}</span>
                    {l.title.split(" · ")[0]}
                  </div>
                  <div className="bench-row">
                    <span className="bar-label">hyper</span>
                    <div className="bar"><div className="bar-fill hyper" style={{ width: `${hyperPct}%` }} /></div>
                    <span className="bar-val">{l.hyper_ms_median.toFixed(1)}ms</span>
                  </div>
                  <div className="bench-row">
                    <span className="bar-label">triplet</span>
                    <div className="bar"><div className="bar-fill triplet" style={{ width: `${tripletPct}%` }} /></div>
                    <span className="bar-val">{l.triplet_ms_median.toFixed(1)}ms</span>
                  </div>
                  <div className="bench-row" title="minute×player hub-scoped triplet">
                    <span className="bar-label">hub</span>
                    <div className="bar"><div className="bar-fill hub" style={{ width: `${hubPct}%` }} /></div>
                    <span className="bar-val">{hubMs.toFixed(1)}ms</span>
                  </div>
                </div>
              );
            })}
            <div className="bench-blowup">
              overall median · hyper <b>{report.totals.hyper_ms_median}ms</b>
              {" · "}triplet <b>{report.totals.triplet_ms_median}ms</b>
              {" · "}hub <b>{(report.totals.triplet_hub_ms_median ?? 0)}ms</b>
            </div>
          </div>

          <button className="filter-btn" onClick={() => run(report.iterations)} disabled={loading} style={{ marginTop: 8 }}>
            {loading ? "재측정…" : `재측정 (${report.iterations} iter)`}
          </button>
        </>
      )}
    </div>
  );
}
