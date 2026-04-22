import { useCallback, useEffect, useState } from "react";
import type { Dataset, Filters, ViewMode } from "./types";
import { fetchDataset, fetchHealth, refreshServer } from "./api";
import { TemporalScene } from "./viz/TemporalScene";
import { StatsPanel } from "./ui/StatsPanel";
import { QueryPanel } from "./ui/QueryPanel";
import { NarrativePanel } from "./ui/NarrativePanel";

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
  const [dataSource, setDataSource] = useState<"typedb" | "fallback" | "none" | null>(null);
  const [spacingMult, setSpacingMult] = useState(1);
  const [nodeScale, setNodeScale] = useState(0.9);
  const [highlightNsIds, setHighlightNsIds] = useState<Set<string> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [ds, h] = await Promise.all([fetchDataset(), fetchHealth()]);
      setDataset(ds);
      setTypedbAvailable(h.typedb_available);
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
      <div className="app" style={{ padding: 40, color: "var(--accent-red)" }}>
        <h2>Failed to load dataset</h2>
        <pre>{err}</pre>
        <p>Run <code>bun run backend/src/cmd/mockgen.ts</code> then <code>bun run backend/src/cmd/server.ts</code>.</p>
      </div>
    );
  }
  if (!dataset) {
    return <div className="app" style={{ padding: 40, color: "var(--text-dim)" }}>loading…</div>;
  }

  return (
    <div className="app">
      <div className="stage">
        <TemporalScene
          dataset={dataset}
          viewMode={viewMode}
          filters={filters}
          spacingMult={spacingMult}
          nodeScale={nodeScale}
          highlightNsIds={highlightNsIds}
        />
      </div>

      <div className="hud-overlay">
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

      <div className="controls">
        <button
          className={"mode-btn" + (viewMode === "minute" ? " active" : "")}
          onClick={() => setViewMode("minute")}
        >
          1min · 60 planes
        </button>
        <button
          className={"mode-btn" + (viewMode === "hour" ? " active" : "")}
          onClick={() => setViewMode("hour")}
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
