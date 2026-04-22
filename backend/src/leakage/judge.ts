// Judge layer — assigns a precision/leakage score to each leakage case.
//
// Three tiers:
//   1. Heuristic (default) — pure arithmetic over answer counts. Works
//      offline, no external dependency.
//   2. OpenAI   — set LLM_JUDGE=openai    and OPENAI_API_KEY.
//   3. Anthropic — set LLM_JUDGE=anthropic and ANTHROPIC_API_KEY.
//
// The LLM prompt is identical across providers; only the transport differs.

import type { CaseResult } from "./runner.ts";
import type { LeakageCase } from "./cases.ts";

export interface Verdict {
  score: number;                      // 0..100
  kind: "phantom" | "underrecall" | "exact" | "empty";
  rule_verdict: string;
  llm_verdict?: string;
  judge: "heuristic" | "openai" | "anthropic";
}

// Pure arithmetic score — triplet vs hyperedge answer counts.
export function heuristicScore(c: CaseResult, spec: LeakageCase): Verdict {
  const h = c.hyper.count;
  const t = c.triplet.count;
  let score = 100, kind: Verdict["kind"] = "exact", rule = "";

  if (h === 0 && t === 0) {
    score = 100; kind = "empty";
    rule = "두 그래프 모두 답변 없음 — 질문이 실제로 해당하는 에피소드가 없는 경우이거나 스키마 차이 테스트. 일관된 음성.";
  } else if (h === 0 && t > 0) {
    score = 0; kind = "phantom";
    rule = `n-ary는 구조적 0을 반환하지만 triplet은 ${t}개의 경로를 반환 — 100% phantom (존재하지 않은 사건 조합).`;
  } else if (t === 0 && h > 0) {
    score = 0; kind = "underrecall";
    rule = `triplet은 ${h}개 중 0건도 복구하지 못함 — 스키마가 질의 의미를 표현할 수 없음.`;
  } else if (h === t) {
    score = 100; kind = "exact";
    rule = `동일한 ${h}건을 반환 — 정확 매칭(의미적 일치).`;
  } else if (t > h) {
    const phantomRate = (t - h) / t;
    score = Math.round((1 - phantomRate) * 100);
    kind = "phantom";
    rule = `triplet=${t}, hyper=${h} → 차이 ${t - h}건이 cross-episode 조합에서 생성된 phantom. Precision ≈ ${(h / t).toFixed(2)}.`;
  } else {
    const missRate = (h - t) / h;
    score = Math.round((1 - missRate) * 100);
    kind = "underrecall";
    rule = `triplet=${t}, hyper=${h} → ${h - t}건을 놓침 (pair-wise dedupe로 event cardinality가 소실).`;
  }

  // Multi-hop case는 weight를 더 부여하고 싶다면 여기서 조정. 기준 점수는 동일하게 유지.
  return { score, kind, rule_verdict: rule, judge: "heuristic" };
}

// ---------------------------------------------------------------------------
// LLM providers
// ---------------------------------------------------------------------------

function buildPrompt(c: CaseResult, spec: LeakageCase): string {
  return `You are scoring a graph query response for episode-boundary correctness.

Context: two graph databases hold the SAME MMORPG events.
- TypeDB uses an n-ary "episode" relation: each event is one hyperedge
  with role players bound atomically (actor / counterpart / mob_target /
  item_payload / at_location / via_device).
- FalkorDB uses pair-wise triplet edges with NO episode identity on
  edges. Traversals can combine edges from DIFFERENT episodes.

Question (${spec.kind}): ${c.title}
Note: ${c.note}

Hyperedge query (ground truth) returned: ${c.hyper.count} answers.
Triplet query     (candidate) returned: ${c.triplet.count} answers.

Score the triplet response from 0 (all phantom) to 100 (exact match),
considering whether the response contains cross-episode false positives
or misses event cardinality. Reply in JSON: {"score": N, "reason": "..."}.`;
}

async function openaiScore(c: CaseResult, spec: LeakageCase): Promise<Verdict | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_JUDGE_MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: buildPrompt(c, spec) }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const raw = body.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));
    const reason = String(parsed.reason ?? "");
    const heur = heuristicScore(c, spec);
    return { ...heur, score, llm_verdict: reason, judge: "openai" };
  } catch { return null; }
}

async function anthropicScore(c: CaseResult, spec: LeakageCase): Promise<Verdict | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key,
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_JUDGE_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: "user", content: buildPrompt(c, spec) + "\n\nReply ONLY with a JSON object." }],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const text = body.content?.[0]?.text ?? "{}";
    // Claude often wraps JSON in ``` — strip.
    const clean = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(clean);
    const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));
    const reason = String(parsed.reason ?? "");
    const heur = heuristicScore(c, spec);
    return { ...heur, score, llm_verdict: reason, judge: "anthropic" };
  } catch { return null; }
}

export async function judgeCase(c: CaseResult, spec: LeakageCase): Promise<Verdict> {
  const provider = process.env.LLM_JUDGE?.toLowerCase();
  if (provider === "openai") {
    const v = await openaiScore(c, spec);
    if (v) return v;
  }
  if (provider === "anthropic") {
    const v = await anthropicScore(c, spec);
    if (v) return v;
  }
  return heuristicScore(c, spec);
}
