// Deterministic MMORPG event generator for the n_ary_test visualisation and
// TypeDB query-test suite.
//
// One player produces ~1000 episodes over a 60-minute window that deliberately
// straddles a clock-hour boundary (09:30 – 10:30 UTC) so the 1-hour aggregation
// view shows two partly-filled planes and a measurable population of cross-hour
// hyperedges (~3%). Cross-minute hyperedges land at ~9% by construction.

import type {
  Dataset,
  Device,
  Episode,
  Item,
  Location,
  Mob,
  NPC,
  Player,
  Role,
  RoleName,
} from "../domain/types.ts";

export const TARGET_EPISODES = 1000;
export const WINDOW_MINUTES = 60;
export const CROSS_MINUTE_RATIO = 0.09;
export const CROSS_HOUR_RATIO = 0.03;
export const WINDOW_START = new Date(Date.UTC(2026, 3, 22, 9, 30, 0));

// 엔티티 ID는 유지(P1/L1/...)하여 TypeQL/스키마 호환을 지키고, 라벨만 한글화한다.
// 사용자 시각화와 서사에서 보이는 이름은 모두 username/zone_name/npc_kind 등이다.
const players: Player[] = [{ id: "P1", username: "영주님" }];

const devices: Device[] = [
  { id: "D1", kind: "PC" },
  { id: "D2", kind: "모바일" },
];

const locations: Location[] = [
  { id: "L1", name: "광장" },
  { id: "L2", name: "숲변두리" },
  { id: "L3", name: "던전1" },
  { id: "L4", name: "던전2" },
  { id: "L5", name: "길드홀" },
  { id: "L6", name: "시장" },
];

const npcs: NPC[] = [
  { id: "N1", kind: "상인" },
  { id: "N2", kind: "퀘스트주인" },
  { id: "N3", kind: "훈련사" },
  { id: "N4", kind: "안내인" },
  { id: "N5", kind: "길드마스터" },
  { id: "N6", kind: "라이벌" },
];

const mobs: Mob[] = [
  { id: "M1", species: "슬라임" },
  { id: "M2", species: "고블린" },
  { id: "M3", species: "늑대" },
  { id: "M4", species: "도적" },
  { id: "M5", species: "원령" },
  { id: "M6", species: "트롤" },
  { id: "M7", species: "드래곤새끼" },
  { id: "M8", species: "해골" },
];

const items: Item[] = [
  { id: "I1",  kind: "포션" },
  { id: "I2",  kind: "검" },
  { id: "I3",  kind: "방패" },
  { id: "I4",  kind: "금화" },
  { id: "I5",  kind: "보석" },
  { id: "I6",  kind: "지도" },
  { id: "I7",  kind: "약초" },
  { id: "I8",  kind: "광석" },
  { id: "I9",  kind: "부적" },
  { id: "I10", kind: "활" },
  { id: "I11", kind: "화살" },
  { id: "I12", kind: "두루마리" },
  { id: "I13", kind: "열쇠" },
  { id: "I14", kind: "룬" },
];

interface RelationSpec {
  name: string;
  activity: string;
  moods: string[];
  needDevice: boolean;
  needLocation: boolean;
  counterparts: [number, number];
  mobTargets: [number, number];
  itemPayload: [number, number];
  baseImportance: number;
  avgDurationMs: number;
  weight: number;
}

const specs: RelationSpec[] = [
  { name: "login",          activity: "authentication", moods: ["neutral", "focused"],                          needDevice: true,  needLocation: true,  counterparts: [0, 0], mobTargets: [0, 0], itemPayload: [0, 0], baseImportance: 0.35, avgDurationMs:    800, weight:  2 },
  { name: "logout",         activity: "authentication", moods: ["neutral", "tired"],                            needDevice: true,  needLocation: false, counterparts: [0, 0], mobTargets: [0, 0], itemPayload: [0, 0], baseImportance: 0.30, avgDurationMs:    500, weight:  2 },
  { name: "enter_zone",     activity: "traversal",      moods: ["neutral", "curious"],                          needDevice: false, needLocation: true,  counterparts: [0, 0], mobTargets: [0, 0], itemPayload: [0, 0], baseImportance: 0.25, avgDurationMs:   3500, weight: 10 },
  { name: "chat_npc",       activity: "social",         moods: ["neutral", "friendly", "curious"],              needDevice: false, needLocation: true,  counterparts: [1, 1], mobTargets: [0, 0], itemPayload: [0, 0], baseImportance: 0.28, avgDurationMs:   6000, weight: 14 },
  { name: "trade",          activity: "commerce",       moods: ["neutral", "excited"],                          needDevice: false, needLocation: true,  counterparts: [1, 1], mobTargets: [0, 0], itemPayload: [1, 3], baseImportance: 0.55, avgDurationMs:   5500, weight: 10 },
  { name: "accept_quest",   activity: "quest",          moods: ["focused", "excited"],                          needDevice: false, needLocation: true,  counterparts: [1, 1], mobTargets: [0, 0], itemPayload: [0, 1], baseImportance: 0.62, avgDurationMs:   4000, weight:  8 },
  { name: "complete_quest", activity: "quest",          moods: ["triumphant", "satisfied"],                     needDevice: false, needLocation: true,  counterparts: [1, 1], mobTargets: [0, 0], itemPayload: [1, 3], baseImportance: 0.85, avgDurationMs:   4500, weight:  8 },
  { name: "kill_mob",       activity: "combat",         moods: ["aggressive", "focused", "cautious"],           needDevice: false, needLocation: true,  counterparts: [0, 0], mobTargets: [1, 1], itemPayload: [0, 2], baseImportance: 0.65, avgDurationMs:   9000, weight: 20 },
  { name: "use_item",       activity: "utility",        moods: ["neutral", "urgent"],                           needDevice: false, needLocation: true,  counterparts: [0, 0], mobTargets: [0, 0], itemPayload: [1, 1], baseImportance: 0.40, avgDurationMs:    600, weight: 12 },
  { name: "level_up",       activity: "progression",    moods: ["triumphant"],                                  needDevice: false, needLocation: true,  counterparts: [0, 0], mobTargets: [0, 0], itemPayload: [0, 1], baseImportance: 0.90, avgDurationMs:   1200, weight:  2 },
  { name: "party_invite",   activity: "social",         moods: ["friendly"],                                    needDevice: false, needLocation: true,  counterparts: [1, 2], mobTargets: [0, 0], itemPayload: [0, 0], baseImportance: 0.38, avgDurationMs:   3000, weight:  6 },
  { name: "duel",           activity: "combat",         moods: ["aggressive", "focused"],                       needDevice: false, needLocation: true,  counterparts: [1, 1], mobTargets: [0, 0], itemPayload: [0, 1], baseImportance: 0.72, avgDurationMs:  25000, weight:  6 },
];

// mulberry32 seeded PRNG — same algorithm used in docs/html/temporal_layers_3d.html,
// so cross-tool reproducibility is trivial if we ever want to share seeds.
function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand: () => number): RelationSpec {
  const total = specs.reduce((a, s) => a + s.weight, 0);
  const pick = rand() * total;
  let acc = 0;
  for (const s of specs) {
    acc += s.weight;
    if (pick < acc) return s;
  }
  return specs[specs.length - 1]!;
}

function rangeInt(rand: () => number, [lo, hi]: [number, number]): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function isoUTC(d: Date): string {
  return d.toISOString();
}

export function generate(seed: number): Dataset {
  const rand = mulberry32(seed);
  const end = new Date(WINDOW_START.getTime() + WINDOW_MINUTES * 60_000);

  // Distribute event_time across the window with mild clustering near the
  // hour boundary.
  const times: Date[] = [];
  for (let i = 0; i < TARGET_EPISODES; i++) {
    const base = rand();
    const skew = (rand() - 0.5) * 0.2;
    const frac = clamp(base + skew, 0, 1);
    const jitterMs = Math.floor(rand() * 1000);
    const offsetMs = Math.floor(frac * (end.getTime() - WINDOW_START.getTime())) + jitterMs;
    times.push(new Date(WINDOW_START.getTime() + offsetMs));
  }

  const episodes: Episode[] = [];
  for (let i = 0; i < times.length; i++) {
    const spec = pickWeighted(rand);
    let t = times[i]!;
    let durMs = Math.floor(spec.avgDurationMs * (0.7 + rand() * 0.6));

    const roll = rand();
    if (roll < CROSS_MINUTE_RATIO) {
      // pad duration until it bleeds into the next minute
      const msIntoMinute = (t.getSeconds() * 1000) + t.getMilliseconds();
      const need = (60_000 - msIntoMinute) + (500 + Math.floor(rand() * 3500));
      if (need > durMs) durMs = need;
    }
    if (roll < CROSS_HOUR_RATIO) {
      // re-seat near the hour boundary (10:00) and make the episode wide
      const anchorOffset = (WINDOW_MINUTES / 2) * 60_000 - Math.floor(rand() * 40_000);
      t = new Date(WINDOW_START.getTime() + anchorOffset);
      times[i] = t;
      durMs = 40_000 + Math.floor(rand() * 60_000);
    }

    const validFrom = t;
    const validUntil = new Date(t.getTime() + durMs);

    const unix = Math.floor(t.getTime() / 1000);
    const validFromUnix = Math.floor(validFrom.getTime() / 1000);
    const validUntilUnix = Math.floor(validUntil.getTime() / 1000);

    const roles: Role[] = [{ role: "actor", entity_id: players[0]!.id, entity_kind: "player" }];

    if (spec.needLocation) {
      const loc = pick(rand, locations);
      roles.push({ role: "at_location", entity_id: loc.id, entity_kind: "location" });
    }
    if (spec.needDevice) {
      const d = pick(rand, devices);
      roles.push({ role: "via_device", entity_id: d.id, entity_kind: "device" });
    }
    const nCp = rangeInt(rand, spec.counterparts);
    for (let j = 0; j < nCp; j++) {
      roles.push({ role: "counterpart", entity_id: pick(rand, npcs).id, entity_kind: "npc" });
    }
    const nMob = rangeInt(rand, spec.mobTargets);
    for (let j = 0; j < nMob; j++) {
      roles.push({ role: "mob_target", entity_id: pick(rand, mobs).id, entity_kind: "mob" });
    }
    const nItem = rangeInt(rand, spec.itemPayload);
    for (let j = 0; j < nItem; j++) {
      roles.push({ role: "item_payload", entity_id: pick(rand, items).id, entity_kind: "item" });
    }

    const locationId = roles.find((r) => r.role === "at_location")?.entity_id ?? "none";

    const ep: Episode = {
      ns_id: `ep-${String(i + 1).padStart(4, "0")}`,
      relation_type: spec.name,
      event_time: isoUTC(t),
      minute_bucket: Math.floor(unix / 60),
      hour_bucket: Math.floor(unix / 3600),
      valid_from: isoUTC(validFrom),
      valid_until: isoUTC(validUntil),
      importance: Number(clamp(spec.baseImportance + (rand() - 0.5) * 0.3, 0.05, 1.0).toFixed(4)),
      belief: Number(clamp(0.8 + (rand() - 0.5) * 0.35, 0.4, 1.0).toFixed(4)),
      crosses_minute: Math.floor(validFromUnix / 60) !== Math.floor(validUntilUnix / 60),
      crosses_hour: Math.floor(validFromUnix / 3600) !== Math.floor(validUntilUnix / 3600),
      activity_type: spec.activity,
      mood: pick(rand, spec.moods),
      community_id: `c_${spec.activity}_${locationId}`,
      source_ref: `kafka://events/${i + 1}`,
      roles,
      raw_log: {},
    };

    ep.raw_log = {
      ts: ep.event_time,
      type: ep.relation_type,
      player_id: players[0]!.id,
      session_id: "sess-0001",
      valid_from_ms: validFrom.getTime(),
      valid_until_ms: validUntil.getTime(),
      duration_ms: durMs,
      fields: fieldsFrom(ep),
    };
    episodes.push(ep);
  }

  return {
    generated_at: new Date().toISOString(),
    seed,
    window_start: isoUTC(WINDOW_START),
    window_end: isoUTC(end),
    players,
    devices,
    locations,
    npcs,
    mobs,
    items,
    episodes,
  };
}

function fieldsFrom(ep: Episode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    activity_type: ep.activity_type,
    mood: ep.mood,
    community_id: ep.community_id,
    importance: ep.importance,
    belief: ep.belief,
  };
  for (const r of ep.roles) {
    const existing = out[r.role];
    if (existing === undefined) {
      out[r.role] = r.entity_id;
    } else if (Array.isArray(existing)) {
      (existing as string[]).push(r.entity_id);
    } else {
      out[r.role] = [existing as string, r.entity_id];
    }
  }
  return out;
}
