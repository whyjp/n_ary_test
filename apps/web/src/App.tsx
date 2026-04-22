import { useCallback, useEffect, useState } from "react";
import type { Dataset, Filters, ViewMode } from "./types";
import { fetchDataset, fetchHealth, refreshServer } from "./api";
import { TemporalScene } from "./viz/TemporalScene";
import { FalkorScene } from "./viz/FalkorScene";

type GraphSource = "typedb" | "falkor";
import { StatsPanel } from "./ui/StatsPanel";
import { QueryPanel } from "./ui/QueryPanel";
import { NarrativePanel } from "./ui/NarrativePanel";
import { LeakagePanel } from "./ui/LeakagePanel";
import { InfographicBar } from "./ui/InfographicBar";

const INITIAL_FILTERS: Filters = {
  relationType: null,
  activityType: null,
  touchEntity: null,
  onlyCrossBoundary: false,
  minImportance: 0,
};

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("hour");
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [typedbAvailable, setTypedbAvailable] = useState<boolean | null>(null);
  const [falkorAvailable, setFalkorAvailable] = useState<boolean | null>(null);
  const [dataSource, setDataSource] = useState<"typedb" | "none" | null>(null);
  const [spacingMult, setSpacingMult] = useState(1);
  const [nodeScale, setNodeScale] = useState(0.9);
  const [highlightNsIds, setHighlightNsIds] = useState<Set<string> | null>(null);
  const [graphSource, setGraphSource] = useState<GraphSource>("typedb");
  const [err, setErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [ds, h] = await Promise.all([fetchDataset(), fetchHealth()]);
      setDataset(ds);
      setTypedbAvailable(h.typedb_available);
      setFalkorAvailable(h.falkor_available);
      setDataSource(h.data_source);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const onRefresh = useCallback(async () => {
    try {
      await refreshServer();
      await loadAll();
    } catch (e) {
      setErr(String(e));
    }
  }, [loadAll]);

  if (err) {
    return (
      <div className="app error-state">
        <div style={{ maxWidth: 640 }}>
          <div className="eyebrow" style={{ color: "var(--accent-red)" }}>
            typedb offline · no local fallback
          </div>
          <h2 style={{ fontFamily: "var(--display)", fontWeight: 300, fontSize: 34, margin: "14px 0 18px" }}>
            데이터는 <em style={{ color: "var(--accent-nary)", fontStyle: "italic" }}>TypeDB</em>에서만 읽습니다.
          </h2>
          <pre style={{
            fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "pre-wrap",
            background: "rgba(255,107,107,0.08)", border: "0.5px solid rgba(255,107,107,0.4)",
            padding: 14, color: "var(--text)",
          }}>{err}</pre>
          <div style={{ marginTop: 22, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6 }}>
            복구 순서 (WSL 별도 터미널):
            <ol style={{ paddingLeft: 20, marginTop: 10 }}>
              <li><code>bash scripts/typedb-up.sh</code></li>
              <li><code>cd backend &amp;&amp; bun run src/cmd/mockgen.ts</code></li>
              <li><code>bun run src/cmd/load.ts --reset</code></li>
              <li><code>bun run src/cmd/load-falkor.ts --reset</code></li>
              <li>페이지 새로고침</li>
            </ol>
          </div>
          <button className="filter-btn" style={{ marginTop: 20 }} onClick={() => { setErr(null); void loadAll(); }}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }
  if (!dataset) {
    return <div className="app" style={{ padding: 40, color: "var(--text-dim)" }}>loading…</div>;
  }

  return (
    <div className="app">
      <div className="stage">
        {graphSource === "typedb" ? (
          <TemporalScene
            dataset={dataset}
            viewMode={viewMode}
            filters={filters}
            spacingMult={spacingMult}
            nodeScale={nodeScale}
            highlightNsIds={highlightNsIds}
          />
        ) : (
          <FalkorScene nodeScale={nodeScale} />
        )}
      </div>

      <div className="hud-overlay">
      <InfographicBar />
      <div className="header">
        <div className="eyebrow">n-ary hyperedges · temporal layers</div>
        <div className="title">
          1분/1시간 <em>평면</em> · 교차 하이퍼엣지
        </div>
        <div className="subtitle">
          1 player · 60 min · {dataset.episodes.length} episodes. Each episode is a hyperedge
          connecting typed entities across the L0/L1/L2/L3 NodeSet layers. Minute view shows
          {" "}{new Date(dataset.window_end).getUTCMinutes() === 30 ? 60 : 60} planes at 1-minute resolution;
          hour view aggregates into 2 planes straddling the 10:00 boundary.
        </div>
      </div>

      <StatsPanel
        dataset={dataset}
        filters={filters}
        typedbAvailable={typedbAvailable}
        falkorAvailable={falkorAvailable}
        dataSource={dataSource}
        onRefresh={onRefresh}
      />
      <QueryPanel
        dataset={dataset}
        filters={filters}
        onChange={setFilters}
        typedbAvailable={typedbAvailable}
      />
      <NarrativePanel onHighlight={setHighlightNsIds} />
      <LeakagePanel onHighlight={setHighlightNsIds} />

      <div className="controls">
        <div className="source-group">
          <button
            className={"mode-btn source" + (graphSource === "typedb" ? " active typedb" : "")}
            onClick={() => setGraphSource("typedb")}
            title="TypeDB n-ary hyperedge 그래프"
          >TypeDB · n-ary</button>
          <button
            className={"mode-btn source" + (graphSource === "falkor" ? " active falkor" : "")}
            onClick={() => setGraphSource("falkor")}
            title="FalkorDB pair-wise triplet 그래프 (시간축 없음)"
          >FalkorDB · triplet</button>
        </div>
        <button
          className={"mode-btn" + (viewMode === "minute" ? " active" : "")}
          onClick={() => setViewMode("minute")}
          disabled={graphSource !== "typedb"}
        >
          1min · 60 planes
        </button>
        <button
          className={"mode-btn" + (viewMode === "hour" ? " active" : "")}
          onClick={() => setViewMode("hour")}
          disabled={graphSource !== "typedb"}
        >
          1h · 2 planes
        </button>
        <div className="slider-group">
          <label>
            <span>spacing</span>
            <input
              type="range" min={0.4} max={4} step={0.05}
              value={spacingMult} onChange={(e) => setSpacingMult(Number(e.target.value))}
            />
            <span className="num">{spacingMult.toFixed(2)}×</span>
          </label>
          <label>
            <span>node</span>
            <input
              type="range" min={0.3} max={2.0} step={0.05}
              value={nodeScale} onChange={(e) => setNodeScale(Number(e.target.value))}
            />
            <span className="num">{nodeScale.toFixed(2)}×</span>
          </label>
        </div>
      </div>

      <div className="hint">drag to rotate · scroll to zoom</div>
      </div>
    </div>
  );
}
