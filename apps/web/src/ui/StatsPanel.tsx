import type { Dataset, Filters } from "../types";

interface Props {
  dataset: Dataset;
  filters: Filters;
  typedbAvailable: boolean | null;
  falkorAvailable: boolean | null;
  dataSource: "typedb" | "none" | null;
  onRefresh: () => void;
}

export function StatsPanel({ dataset, filters, typedbAvailable, falkorAvailable, dataSource, onRefresh }: Props) {
  const crossMinute = dataset.episodes.filter((e) => e.crosses_minute).length;
  const crossHour = dataset.episodes.filter((e) => e.crosses_hour).length;
  const visible = dataset.episodes.filter((e) => {
    if (filters.relationType && e.relation_type !== filters.relationType) return false;
    if (filters.activityType && e.activity_type !== filters.activityType) return false;
    if (filters.touchEntity && !e.roles.some((r) => r.entity_id === filters.touchEntity)) return false;
    if (filters.onlyCrossBoundary && !(e.crosses_minute || e.crosses_hour)) return false;
    if (e.importance < filters.minImportance) return false;
    return true;
  }).length;

  const entityCount =
    dataset.players.length +
    dataset.npcs.length +
    dataset.locations.length +
    dataset.devices.length +
    dataset.mobs.length +
    dataset.items.length;

  return (
    <div className="panel stats">
      <div className="title-row">Composition</div>
      <div className="row">
        <span className="k">Total episodes</span>
        <span className="v accent">{dataset.episodes.length}</span>
      </div>
      <div className="row">
        <span className="k">Visible (filters)</span>
        <span className="v accent">{visible}</span>
      </div>
      <div className="row">
        <span className="k">Entities</span>
        <span className="v">{entityCount}</span>
      </div>
      <hr className="hr" />
      <div className="row">
        <span className="k">Crosses minute</span>
        <span className="v warn">{crossMinute}</span>
      </div>
      <div className="row">
        <span className="k">Crosses hour</span>
        <span className="v warn">{crossHour}</span>
      </div>
      <hr className="hr" />
      <div className="row">
        <span className="k">Window</span>
        <span className="v">
          {dataset.window_start.slice(11, 16)}—{dataset.window_end.slice(11, 16)}
        </span>
      </div>
      <div className="row">
        <span className="k">Seed</span>
        <span className="v">{dataset.seed}</span>
      </div>
      <div className="row">
        <span className="k">TypeDB · n-ary</span>
        <span className="v" style={{ color: typedbAvailable ? "var(--accent-nary)" : "var(--accent-red)" }}>
          {typedbAvailable === null ? "…" : typedbAvailable ? "connected" : "offline"}
        </span>
      </div>
      <div className="row">
        <span className="k">FalkorDB · triplet</span>
        <span className="v" style={{ color: falkorAvailable ? "var(--accent-nary)" : "var(--accent-red)" }}>
          {falkorAvailable === null ? "…" : falkorAvailable ? "connected" : "offline"}
        </span>
      </div>
      <div className="row">
        <span className="k">Data source</span>
        <span className="v" style={{
          color: dataSource === "typedb" ? "var(--accent-nary)" : "var(--accent-red)",
        }}>
          {dataSource ?? "—"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        <button className="filter-btn" onClick={onRefresh} title="서버의 TypeDB 캐시를 재동기화">
          ↻ refresh dataset (from TypeDB)
        </button>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.08em",
          color: "var(--text-faint)", lineHeight: 1.6,
        }}>
          FalkorDB 재적재(hub 포함)는 CLI에서:<br />
          <code style={{ color: "var(--accent-pg)" }}>bash scripts/falkor-load.sh --reset</code>
        </div>
      </div>
    </div>
  );
}
