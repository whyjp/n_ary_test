// Rule-based NL → TypeQL + episode-to-sentence renderer.
//
// Understands *both* English and Korean phrasing — keywords are unified via
// a synonyms table keyed on normalised lowercase input. The translator is
// intentionally small; it covers time ranges, entity lookups, activity/
// relation intents, cross-boundary and importance flags.

import type { Dataset, Episode, EntityKind } from "../domain/types.ts";

export interface NLResult {
  question: string;
  tql: string;
  filter: EpisodeFilter;
  matches: Episode[];
  narrative: string[];
}

export interface EpisodeFilter {
  fromMinuteBucket?: number;
  toMinuteBucket?: number;
  relationType?: string;
  activityType?: string;
  mood?: string;
  touchEntity?: string;
  locationId?: string;
  npcId?: string;
  itemId?: string;
  mobId?: string;
  crossBoundary?: boolean;
  crossHour?: boolean;
  minImportance?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Entity catalogue — indexed by id AND label (so "영주님" and "P1" both work).
// ---------------------------------------------------------------------------

interface CatalogueLookup {
  entityIdByName(name: string): { id: string; kind: EntityKind } | null;
}

function buildCatalogue(ds: Dataset): CatalogueLookup {
  const idx: Record<string, { id: string; kind: EntityKind }> = {};
  const add = (kind: EntityKind, id: string, label: string) => {
    idx[id.toLowerCase()] = { id, kind };
    idx[label.toLowerCase()] = { id, kind };
  };
  for (const p of ds.players)   add("player",   p.id, p.username);
  for (const d of ds.devices)   add("device",   d.id, d.kind);
  for (const l of ds.locations) add("location", l.id, l.name);
  for (const n of ds.npcs)      add("npc",      n.id, n.kind);
  for (const m of ds.mobs)      add("mob",      m.id, m.species);
  for (const i of ds.items)     add("item",     i.id, i.kind);
  return { entityIdByName: (name) => idx[name.toLowerCase()] ?? null };
}

// ---------------------------------------------------------------------------
// Keyword synonyms (KR + EN) → canonical activity / relation_type values.
// ---------------------------------------------------------------------------

const ACTIVITY_SYNONYMS: Array<[RegExp, string]> = [
  [/전투|싸움|사냥|fight|combat/i, "combat"],
  [/퀘스트|임무|quest|mission/i, "quest"],
  [/거래|장사|상점|무역|trade|commerce|trading|buy|sell/i, "commerce"],
  [/대화|채팅|수다|친구|social|chat(ting)?|talk(ing)?|party/i, "social"],
  [/로그인|로그아웃|접속|auth/i, "authentication"],
  [/이동|이동중|여행|traverse|move|travel|enter/i, "traversal"],
  [/레벨[- ]?업|성장|progress(ion)?|levelup/i, "progression"],
  [/사용|쓰다|utility/i, "utility"],
];

const RELATION_SYNONYMS: Array<[RegExp, string]> = [
  [/잡은|처치|사냥한|몹\s*처치|kill[- ]?mob|killed[- ]?mob/i, "kill_mob"],
  [/대화|채팅|이야기|chat(ted)?[- ]?npc|chat[- ]?with|talk(ed)?\s+to/i, "chat_npc"],
  [/거래|매매|traded?/i, "trade"],
  [/퀘스트\s*수락|받은\s*퀘스트|accept(ed)?[- ]?quest/i, "accept_quest"],
  [/퀘스트\s*완료|완료한?\s*퀘스트|complete(d)?[- ]?quest/i, "complete_quest"],
  [/입장|진입|이동한|enter(ed)?[- ]?zone/i, "enter_zone"],
  [/아이템\s*사용|use(d)?[- ]?item/i, "use_item"],
  [/듀얼|결투|일대일|duel(ed)?/i, "duel"],
  [/로그인|logged?\s+in|login/i, "login"],
  [/로그아웃|logged?\s+out|logout/i, "logout"],
  [/레벨\s*업|level[- ]?up/i, "level_up"],
  [/파티\s*초대|party[- ]?invite/i, "party_invite"],
];

const MOOD_SYNONYMS: Array<[RegExp, string]> = [
  [/의기양양|triumphant/i, "triumphant"],
  [/공격적|aggressive/i, "aggressive"],
  [/조심|cautious/i, "cautious"],
  [/호기심|curious/i, "curious"],
  [/집중|focused/i, "focused"],
  [/중립|neutral/i, "neutral"],
  [/흥분|excited/i, "excited"],
  [/친근|friendly/i, "friendly"],
  [/피곤|tired/i, "tired"],
  [/긴급|urgent/i, "urgent"],
  [/만족|satisfied/i, "satisfied"],
];

// Cross-boundary phrasing
const KW_CROSS_HOUR   = /시간\s*(경계|사이)\s*(넘|횡단|교차|걸친)|1\s*시간\s*경계|한\s*시간\s*경계|cross[- ]?hour|across\s+an\s+hour|hour[- ]?boundary/i;
const KW_CROSS_MINUTE = /분\s*경계\s*(넘|걸친|횡단|교차)|2분\s*이상|cross[- ]?(minute|boundary)|across\s+minutes?|spanning/i;
const KW_IMPORTANT    = /중요(한|할|)|핵심|high[- ]?importance|important|key\s+events?/i;

// ---------------------------------------------------------------------------
// Time parsing — supports Korean particles too: "10:00 이후", "10:00부터",
// "10:00 까지", "10:00 에"
// ---------------------------------------------------------------------------

function parseClock(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Math.floor(Date.UTC(2026, 3, 22, Number(m[1]), Number(m[2])) / 60_000);
}

function extractTimes(q: string): { from?: number; to?: number; at?: number } {
  const out: { from?: number; to?: number; at?: number } = {};

  // between X and Y (EN) / X부터 Y까지 (KR) / X에서 Y (KR)
  const between =
    q.match(/(?:between|from|사이에?|부터)\s*(\d{1,2}:\d{2})\s*(?:and|to|until|~|-|까지|에서)\s*(\d{1,2}:\d{2})/i) ??
    q.match(/(\d{1,2}:\d{2})\s*(?:부터|~|에서)\s*(\d{1,2}:\d{2})\s*(?:까지|사이|동안)?/);
  if (between) {
    const a = parseClock(between[1]!); const b = parseClock(between[2]!);
    if (a != null) out.from = a;
    if (b != null) out.to   = b;
    return out;
  }

  const after = q.match(/(?:after|since|from)\s*(\d{1,2}:\d{2})/i)
              ?? q.match(/(\d{1,2}:\d{2})\s*(?:이후|부터)/);
  if (after) { const a = parseClock(after[1]!); if (a != null) out.from = a; }

  const before = q.match(/(?:before|until|till)\s*(\d{1,2}:\d{2})/i)
              ?? q.match(/(\d{1,2}:\d{2})\s*(?:이전|까지|전에)/);
  if (before) { const a = parseClock(before[1]!); if (a != null) out.to = a; }

  const at = q.match(/\bat\s*(\d{1,2}:\d{2})/i)
          ?? q.match(/(\d{1,2}:\d{2})\s*(?:에|쯤)/);
  if (at && !after && !before) {
    const a = parseClock(at[1]!);
    if (a != null) { out.from = a; out.to = a; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// translate()
// ---------------------------------------------------------------------------

export function translate(question: string, ds: Dataset): EpisodeFilter {
  const q = question.trim();
  const cat = buildCatalogue(ds);
  const filter: EpisodeFilter = {};

  const t = extractTimes(q);
  if (t.from != null) filter.fromMinuteBucket = t.from;
  if (t.to   != null) filter.toMinuteBucket   = t.to;

  if (KW_CROSS_HOUR.test(q))        filter.crossHour = true;
  else if (KW_CROSS_MINUTE.test(q)) filter.crossBoundary = true;

  if (KW_IMPORTANT.test(q)) filter.minImportance = 0.7;

  for (const [re, rel] of RELATION_SYNONYMS) {
    if (re.test(q)) { filter.relationType = rel; break; }
  }
  if (!filter.activityType) {
    for (const [re, act] of ACTIVITY_SYNONYMS) {
      if (re.test(q)) { filter.activityType = act; break; }
    }
  }
  for (const [re, m] of MOOD_SYNONYMS) {
    if (re.test(q)) { filter.mood = m; break; }
  }

  // Entity lookup — scan each whitespace / punctuation token.
  const tokens = q.split(/[\s,;.?!·]+/).filter(Boolean);
  for (const token of tokens) {
    // Also trim common Korean particles from the end.
    const stripped = token.replace(/(에서|에게|에|의|로|를|을|와|과|이|가|은|는)$/, "");
    const hit = cat.entityIdByName(stripped) ?? cat.entityIdByName(token);
    if (!hit) continue;
    if      (hit.kind === "location" && !filter.locationId) filter.locationId = hit.id;
    else if (hit.kind === "npc"      && !filter.npcId)      filter.npcId      = hit.id;
    else if (hit.kind === "item"     && !filter.itemId)     filter.itemId     = hit.id;
    else if (hit.kind === "mob"      && !filter.mobId)      filter.mobId      = hit.id;
    else if (hit.kind !== "player"   && !filter.touchEntity) filter.touchEntity = hit.id;
  }

  filter.limit = 40;
  return filter;
}

// ---------------------------------------------------------------------------
// Filter → TypeQL (transparency preview for the UI).
// ---------------------------------------------------------------------------

export function filterToTypeql(f: EpisodeFilter): string {
  const pats: string[] = ["$e isa episode"];
  const post: string[] = [];
  const selected: string[] = ["$e"];

  const addAttr = (attr: string, varName: string) => {
    pats.push(`has ${attr} ${varName}`);
    selected.push(varName);
  };

  if (f.fromMinuteBucket != null || f.toMinuteBucket != null) {
    addAttr("minute_bucket", "$mb");
    if (f.fromMinuteBucket != null) post.push(`$mb >= ${f.fromMinuteBucket}`);
    if (f.toMinuteBucket   != null) post.push(`$mb <= ${f.toMinuteBucket}`);
  }
  if (f.relationType)  pats.push(`has relation_type "${f.relationType}"`);
  if (f.activityType)  pats.push(`has activity_type "${f.activityType}"`);
  if (f.mood)          pats.push(`has mood "${f.mood}"`);
  if (f.crossHour)     pats.push(`has crosses_hour true`);
  if (f.crossBoundary) pats.push(`has crosses_minute true`);
  if (f.minImportance != null) { addAttr("importance", "$imp"); post.push(`$imp >= ${f.minImportance}`); }

  const linkPatterns: string[] = [];
  const matchPreamble: string[] = [];
  if (f.locationId) {
    matchPreamble.push(`$loc isa location, has location_id "${f.locationId}"`);
    linkPatterns.push(`at_location: $loc`);
  }
  if (f.npcId) {
    matchPreamble.push(`$npc isa npc, has npc_id "${f.npcId}"`);
    linkPatterns.push(`counterpart: $npc`);
  }
  if (f.itemId) {
    matchPreamble.push(`$it isa item, has item_id "${f.itemId}"`);
    linkPatterns.push(`item_payload: $it`);
  }
  if (f.mobId) {
    matchPreamble.push(`$mob isa mob, has mob_id "${f.mobId}"`);
    linkPatterns.push(`mob_target: $mob`);
  }

  const lines: string[] = [];
  lines.push("match");
  for (const mp of matchPreamble) lines.push(`  ${mp};`);
  let body = "  " + pats.join(",\n    ");
  if (linkPatterns.length) body += `,\n    links (${linkPatterns.join(", ")})`;
  body += ";";
  lines.push(body);
  for (const p of post) lines.push(`  ${p};`);
  lines.push(`select ${selected.join(", ")};`);
  if (f.limit) lines.push(`limit ${f.limit};`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Client-side filter application (on the cached Dataset).
// ---------------------------------------------------------------------------

export function applyFilter(ds: Dataset, f: EpisodeFilter): Episode[] {
  let out = ds.episodes;
  if (f.fromMinuteBucket != null) out = out.filter((e) => e.minute_bucket >= f.fromMinuteBucket!);
  if (f.toMinuteBucket   != null) out = out.filter((e) => e.minute_bucket <= f.toMinuteBucket!);
  if (f.relationType)             out = out.filter((e) => e.relation_type === f.relationType);
  if (f.activityType)             out = out.filter((e) => e.activity_type === f.activityType);
  if (f.mood)                     out = out.filter((e) => e.mood === f.mood);
  if (f.crossHour)                out = out.filter((e) => e.crosses_hour);
  if (f.crossBoundary)            out = out.filter((e) => e.crosses_minute);
  if (f.minImportance != null)    out = out.filter((e) => e.importance >= f.minImportance!);
  if (f.locationId)               out = out.filter((e) => e.roles.some((r) => r.role === "at_location" && r.entity_id === f.locationId));
  if (f.npcId)                    out = out.filter((e) => e.roles.some((r) => r.role === "counterpart" && r.entity_id === f.npcId));
  if (f.itemId)                   out = out.filter((e) => e.roles.some((r) => r.role === "item_payload" && r.entity_id === f.itemId));
  if (f.mobId)                    out = out.filter((e) => e.roles.some((r) => r.role === "mob_target" && r.entity_id === f.mobId));
  if (f.touchEntity)              out = out.filter((e) => e.roles.some((r) => r.entity_id === f.touchEntity));
  out = [...out].sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
  if (f.limit) out = out.slice(0, f.limit);
  return out;
}

// ---------------------------------------------------------------------------
// Narrative rendering — human-readable Korean sentences per episode.
// ---------------------------------------------------------------------------

interface Parts {
  location?: string;
  counterpart?: string;
  mob?: string;
  device?: string;
  items?: string;
}

const KR_TEMPLATES: Record<string, (t: string, p: string, x: Parts) => string> = {
  login:          (t, p, x) => `${t} — ${p}이(가) ${x.device ?? "장치"}로 접속${x.location ? ` (${x.location})` : ""}`,
  logout:         (t, p, x) => `${t} — ${p}이(가) ${x.device ?? "장치"}에서 로그아웃`,
  enter_zone:     (t, p, x) => `${t} — ${p}이(가) ${x.location ?? "어떤 지역"}에 입장`,
  chat_npc:       (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "NPC"}와 대화${x.location ? ` (${x.location})` : ""}`,
  trade:          (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "상인"}과 ${x.items || "품목"} 거래${x.location ? ` (${x.location})` : ""}`,
  accept_quest:   (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "퀘스트주인"}에게서 퀘스트를 수락${x.location ? ` (${x.location})` : ""}`,
  complete_quest: (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "퀘스트주인"}의 퀘스트를 완료${x.items ? `, 보상: ${x.items}` : ""}`,
  kill_mob:       (t, p, x) => `${t} — ${p}이(가) ${x.mob ?? "적"}을(를) 처치${x.location ? ` (${x.location})` : ""}${x.items ? `, 드롭: ${x.items}` : ""}`,
  use_item:       (t, p, x) => `${t} — ${p}이(가) ${x.items || "아이템"}을(를) 사용${x.location ? ` (${x.location})` : ""}`,
  level_up:       (t, p, x) => `${t} — ${p} 레벨업${x.location ? ` (${x.location})` : ""}`,
  party_invite:   (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "누군가"}에게 파티 초대${x.location ? ` (${x.location})` : ""}`,
  duel:           (t, p, x) => `${t} — ${p}이(가) ${x.counterpart ?? "상대"}와 결투${x.location ? ` (${x.location})` : ""}`,
};

function labelFor(id: string, kind: EntityKind, ds: Dataset): string {
  switch (kind) {
    case "player":   return ds.players.find((x) => x.id === id)?.username ?? id;
    case "device":   return ds.devices.find((x) => x.id === id)?.kind ?? id;
    case "location": return ds.locations.find((x) => x.id === id)?.name ?? id;
    case "npc":      { const n = ds.npcs.find((x) => x.id === id); return n ? `${n.kind}(${n.id})` : id; }
    case "mob":      { const m = ds.mobs.find((x) => x.id === id); return m ? `${m.species}(${m.id})` : id; }
    case "item":     return ds.items.find((x) => x.id === id)?.kind ?? id;
  }
}

function partsForEpisode(ep: Episode, ds: Dataset): Parts {
  const p: Parts = {};
  const npcs: string[] = [];
  const items: string[] = [];
  for (const r of ep.roles) {
    const label = labelFor(r.entity_id, r.entity_kind, ds);
    if      (r.role === "at_location") p.location   = label;
    else if (r.role === "via_device")  p.device     = label;
    else if (r.role === "counterpart") npcs.push(label);
    else if (r.role === "mob_target")  p.mob        = label;
    else if (r.role === "item_payload") items.push(label);
  }
  if (npcs.length)  p.counterpart = npcs.join(", ");
  if (items.length) p.items       = items.join(", ");
  return p;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function narrativeFor(episodes: Episode[], ds: Dataset): string[] {
  const primary = ds.players[0]?.username ?? "플레이어";
  const out: string[] = [];
  for (const ep of episodes) {
    const parts = partsForEpisode(ep, ds);
    const t = formatTime(ep.event_time);
    const tmpl = KR_TEMPLATES[ep.relation_type];
    let line = tmpl
      ? tmpl(t, primary, parts)
      : `${t} — ${primary} · ${ep.relation_type}${parts.location ? ` (${parts.location})` : ""}`;
    if      (ep.crosses_hour)   line += "  ⟶ 시간 경계 횡단";
    else if (ep.crosses_minute) line += "  ⟶ 분 경계 횡단";
    out.push(line);
  }
  return out;
}

export function translateAndRun(question: string, ds: Dataset): NLResult {
  const filter = translate(question, ds);
  const tql = filterToTypeql(filter);
  const matches = applyFilter(ds, filter);
  return {
    question,
    tql,
    filter,
    matches,
    narrative: narrativeFor(matches, ds),
  };
}
