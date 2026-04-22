import { useMemo, useState } from "react";
import type { Dataset, Filters } from "../types";
import { runTypeqlQuery } from "../api";

interface Props {
  dataset: Dataset;
  filters: Filters;
  onChange: (next: Filters) => void;
  typedbAvailable: boolean | null;
}

const DEFAULT_TQL = `match
  $p isa player, has player_id "P1";
  $e isa episode,
    links (actor: $p),
    has crosses_hour true;
get $e;`;

export function QueryPanel({ dataset, filters, onChange, typedbAvailable }: Props) {
  const relations = useMemo(
    () => [...new Set(dataset.episodes.map((e) => e.relation_type))].sort(),
    [dataset],
  );
  const activities = useMemo(
    () => [...new Set(dataset.episodes.map((e) => e.activity_type))].sort(),
    [dataset],
  );
  const entities = useMemo(() => {
    const ids: { id: string; label: string }[] = [];
    dataset.players.forEach((p) => ids.push({ id: p.id, label: `player ${p.id}` }));
    dataset.npcs.forEach((n) => ids.push({ id: n.id, label: `npc ${n.id}` }));
    dataset.locations.forEach((l) => ids.push({ id: l.id, label: `location ${l.id}` }));
    dataset.devices.forEach((d) => ids.push({ id: d.id, label: `device ${d.id}` }));
    dataset.mobs.forEach((m) => ids.push({ id: m.id, label: `mob ${m.id}` }));
    dataset.items.forEach((i) => ids.push({ id: i.id, label: `item ${i.id}` }));
    return ids;
  }, [dataset]);

  const [tql, setTql] = useState(DEFAULT_TQL);
  const [tqlResult, setTqlResult] = useState<string>("");
  const [running, setRunning] = useState(false);

  async function onRunTql() {
    setRunning(true);
    setTqlResult("…running via docker exec…");
    try {
      const r = await runTypeqlQuery(tql);
      setTqlResult(
        `ok=${r.ok}  answers=${r.answers}\n` +
          "— stdout ———\n" + r.stdout.slice(0, 1200) +
          (r.stderr ? "\n— stderr ———\n" + r.stderr.slice(0, 400) : ""),
      );
    } catch (e) {
      setTqlResult("error: " + String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel query">
      <div className="title-row">Filter (client-side)</div>

      <label>
        relation_type
        <select
          value={filters.relationType ?? ""}
          onChange={(e) => onChange({ ...filters, relationType: e.target.value || null })}
        >
          <option value="">—</option>
          {relations.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <label>
        activity_type (L2)
        <select
          value={filters.activityType ?? ""}
          onChange={(e) => onChange({ ...filters, activityType: e.target.value || null })}
        >
          <option value="">—</option>
          {activities.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>

      <label>
        touches entity (L0)
        <select
          value={filters.touchEntity ?? ""}
          onChange={(e) => onChange({ ...filters, touchEntity: e.target.value || null })}
        >
          <option value="">—</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </label>

      <label style={{ cursor: "pointer" }}>
        crosses time boundary
        <input
          type="checkbox"
          checked={filters.onlyCrossBoundary}
          onChange={(e) => onChange({ ...filters, onlyCrossBoundary: e.target.checked })}
        />
      </label>

      <label>
        min importance (L1)
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={filters.minImportance}
          onChange={(e) => onChange({ ...filters, minImportance: Number(e.target.value) })}
        />
      </label>

      <button className="filter-btn" onClick={() => onChange({
        relationType: null, activityType: null, touchEntity: null,
        onlyCrossBoundary: false, minImportance: 0,
      })}>
        reset
      </button>

      <hr className="hr" />
      <div className="title-row">TypeQL (server)</div>
      <textarea
        value={tql}
        onChange={(e) => setTql(e.target.value)}
        rows={8}
        style={{
          width: "100%",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          background: "rgba(255,255,255,0.05)",
          color: "var(--text)",
          border: "0.5px solid var(--border-strong)",
          padding: 6,
          resize: "vertical",
        }}
      />
      <button
        className="filter-btn"
        onClick={onRunTql}
        disabled={running || !typedbAvailable}
        style={{ marginTop: 6 }}
      >
        {typedbAvailable ? (running ? "running…" : "run match (docker exec)") : "typedb offline"}
      </button>
      {tqlResult && (
        <pre style={{
          marginTop: 8,
          fontSize: 9,
          maxHeight: 140,
          overflow: "auto",
          background: "rgba(0,0,0,0.4)",
          padding: 6,
          whiteSpace: "pre-wrap",
          color: "var(--text-dim)",
        }}>{tqlResult}</pre>
      )}
    </div>
  );
}
