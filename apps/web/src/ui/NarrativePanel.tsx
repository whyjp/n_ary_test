import { useState } from "react";
import { askNarrative, type NarrativeResponse } from "../api";

interface Props {
  onHighlight: (nsIds: Set<string> | null) => void;
}

const PRESETS = [
  "10:00 이후 던전1 에서 전투",
  "중요한 퀘스트",
  "상인과의 대화",
  "시간 경계를 횡단한 에피소드",
  "10:00 부터 10:20 까지 숲변두리 에서 아이템 사용",
];

export function NarrativePanel({ onHighlight }: Props) {
  const [question, setQuestion] = useState(PRESETS[0]!);
  const [resp, setResp] = useState<NarrativeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(q?: string) {
    const use = (q ?? question).trim();
    if (!use) return;
    setQuestion(use);
    setLoading(true);
    try {
      const r = await askNarrative(use);
      setResp(r);
      onHighlight(new Set(r.matches.map((m) => m.ns_id)));
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setResp(null);
    onHighlight(null);
  }

  return (
    <div className="panel narrative">
      <div className="title-row">에피소드 질의 · 자연어</div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            className="preset-chip"
            title={p}
            onClick={() => { setQuestion(p); void ask(p); }}
          >{p.length > 30 ? p.slice(0, 28) + "…" : p}</button>
        ))}
      </div>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder='예: "10:00 이후 던전1 에서 전투"'
        style={{
          width: "100%",
          fontFamily: "var(--body)",
          fontSize: 12,
          background: "rgba(255,255,255,0.05)",
          color: "var(--text)",
          border: "0.5px solid var(--border-strong)",
          padding: 8,
          resize: "vertical",
          lineHeight: 1.45,
        }}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        <button className="filter-btn" onClick={() => void ask()} disabled={loading} style={{ flex: 1 }}>
          {loading ? "조회 중…" : "질의"}
        </button>
        <button className="filter-btn" onClick={clear} style={{ flex: 0.4 }}>초기화</button>
      </div>

      {resp && (
        <div style={{ marginTop: 10 }}>
          <div className="title-row" style={{ marginBottom: 6 }}>
            {resp.matches.length} 건 — 3D 뷰에서 강조 표시됨
          </div>
          <pre className="narrative-list">
            {resp.narrative.length === 0
              ? "(매칭된 에피소드 없음 — 다른 표현으로 시도해보세요)"
              : resp.narrative.join("\n")}
          </pre>
          <details style={{ marginTop: 6, fontSize: 10, color: "var(--text-faint)" }}>
            <summary style={{ cursor: "pointer" }}>생성된 TypeQL (전송 미실행, 투명성 목적)</summary>
            <pre style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.4)",
              padding: 6,
              marginTop: 4,
              color: "var(--text-dim)",
            }}>{resp.tql}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
