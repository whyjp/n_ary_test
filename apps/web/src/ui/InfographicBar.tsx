import { useEffect, useState } from "react";
import { fetchBenchmarkInfo, type BenchmarkInfo } from "../api";

export function InfographicBar() {
  const [info, setInfo] = useState<BenchmarkInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const i = await fetchBenchmarkInfo(); if (alive) setInfo(i); } catch {}
    };
    void tick();
    const h = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  if (!info) return <div className="infograph-bar loading">collecting benchmark…</div>;

  const typedb = info.typedb ?? { alive: false, database: "—", episodes: 0, entities: 0, cross_minute: 0, cross_hour: 0, window: null };
  const falkor = info.falkor ?? { alive: false, graph: "—", nodes: 0, edges: 0 };
  const leakage = info.leakage ?? null;
  const relCounts = info.relation_counts ?? {};
  const episodes = typedb.episodes ?? 0;
  const edges    = falkor.edges ?? 0;
  const totalEdges = Math.max(episodes, edges, 1);
  const hyperPct   = (episodes / totalEdges) * 100;
  const tripletPct = (edges / totalEdges) * 100;

  // Dominant relation type, for the sparkline-ish display
  const topRelations = Object.entries(relCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="infograph-bar">
      <div className="infograph-title">
        <span className="eyebrow-sm">n-ary hyperedges · episode boundary benchmark</span>
      </div>

      <div className="infograph-grid">
        {/* TypeDB panel */}
        <div className="infograph-db db-typedb">
          <div className="db-head">
            <span className={"db-status " + (typedb.alive ? "ok" : "off")}></span>
            <span className="db-label">TypeDB</span>
            <span className="db-schema">n-ary relation</span>
          </div>
          <div className="db-primary">{episodes.toLocaleString()}<span className="unit">episodes</span></div>
          <div className="db-sub">
            <span>entities <b>{typedb.entities ?? 0}</b></span>
            <span>×min <b>{typedb.cross_minute ?? 0}</b></span>
            <span>×hour <b>{typedb.cross_hour ?? 0}</b></span>
          </div>
          <div className="db-db">db: <code>{typedb.database}</code></div>
        </div>

        {/* Middle — phantom callout */}
        <div className="infograph-center">
          {leakage ? (
            <>
              <div className="phantom-count">{leakage.total_phantom}</div>
              <div className="phantom-label">cross-episode<br/>phantom paths</div>
              <div className="phantom-detail">
                {leakage.phantom_cases} of {leakage.cases} cases leak
              </div>
              <div className="compare-bar">
                <div className="bar-row">
                  <span className="bar-label">hyper</span>
                  <div className="bar"><div className="bar-fill hyper" style={{ width: `${hyperPct}%` }} /></div>
                  <span className="bar-val">{typedb.episodes}</span>
                </div>
                <div className="bar-row">
                  <span className="bar-label">triplet</span>
                  <div className="bar"><div className="bar-fill triplet" style={{ width: `${tripletPct}%` }} /></div>
                  <span className="bar-val">{falkor.edges}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="phantom-nodata">
              leakage 집계 대기 중<br/>
              <span className="phantom-hint">두 DB 모두 연결되어야 합니다</span>
            </div>
          )}
        </div>

        {/* FalkorDB panel */}
        <div className="infograph-db db-falkor">
          <div className="db-head">
            <span className={"db-status " + (falkor.alive ? "ok" : "off")}></span>
            <span className="db-label">FalkorDB</span>
            <span className="db-schema">pair-wise triplet</span>
          </div>
          <div className="db-primary">{edges.toLocaleString()}<span className="unit">edges</span></div>
          <div className="db-sub">
            <span>nodes <b>{falkor.nodes ?? 0}</b></span>
            <span>no episode id</span>
          </div>
          <div className="db-db">graph: <code>{falkor.graph}</code></div>
        </div>
      </div>

      {/* Relation-type mini sparkline */}
      <div className="infograph-sparkline" title="relation_type distribution">
        {topRelations.map(([name, n]) => {
          const max = topRelations[0]?.[1] ?? 1;
          const pct = (n / max) * 100;
          return (
            <div key={name} className="spark-cell">
              <div className="spark-bar" style={{ height: `${pct}%` }} />
              <div className="spark-name">{name}</div>
              <div className="spark-num">{n}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
