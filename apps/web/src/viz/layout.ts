import type { EntityKind } from "../types";

// FNV-1a 32-bit hash — deterministic per entity id so a given entity always
// lands at the same (x,z) regardless of which plane it appears on.
function fnv1a(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const kindConfig: Record<EntityKind, { radius: number; radiusJitter: number; angleBucket: number }> = {
  player:   { radius: 0,   radiusJitter: 0,   angleBucket: 1  }, // always at origin (1 player)
  device:   { radius: 4,   radiusJitter: 0.8, angleBucket: 8  },
  location: { radius: 9,   radiusJitter: 0.6, angleBucket: 12 },
  npc:      { radius: 6.5, radiusJitter: 0.6, angleBucket: 14 },
  mob:      { radius: 8.0, radiusJitter: 1.0, angleBucket: 16 },
  item:     { radius: 10.5, radiusJitter: 0.8, angleBucket: 20 },
};

export function xzFor(id: string, kind: EntityKind): [number, number] {
  const cfg = kindConfig[kind];
  if (cfg.radius === 0) return [0, 0];
  const h = fnv1a(id + ":" + kind);
  const angleSlot = h % cfg.angleBucket;
  const angle = (angleSlot / cfg.angleBucket) * Math.PI * 2;
  const jitter = (((h >>> 8) % 1000) / 1000 - 0.5) * cfg.radiusJitter;
  const r = cfg.radius + jitter;
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

// Colour palette mirroring the reference HTML.
export const ENTITY_COLORS: Record<EntityKind, number> = {
  player: 0x2de8c8,
  device: 0xffb347,
  location: 0xff6b9d,
  npc: 0xa78bfa,
  mob: 0xff6b6b,
  item: 0x60a5fa,
};

export const RELATION_COLORS: Record<string, number> = {
  login:          0x2de8c8,
  logout:         0x60a5fa,
  enter_zone:     0x7dd3fc,
  chat_npc:       0xff6b9d,
  trade:          0xffb347,
  accept_quest:   0xa78bfa,
  complete_quest: 0x34d399,
  kill_mob:       0xff6b6b,
  use_item:       0x94a3b8,
  level_up:       0xfde047,
  party_invite:   0xfb923c,
  duel:           0xf87171,
};

export function relationColor(rel: string): number {
  return RELATION_COLORS[rel] ?? 0xffffff;
}

// tierColor — cold (old) → warm (recent). t in [0,1]. Lightness is pulled
// down so the ring doesn't wash out to near-white under additive blending /
// bloom; saturation kept high enough to keep the temperature signal.
export function tierColorHSL(t: number): [number, number, number] {
  if (t < 0.4) return [0.58 - t * 0.1, 0.6, 0.42];
  if (t < 0.75) {
    const u = (t - 0.4) / 0.35;
    return [0.5 - u * 0.42, 0.7, 0.45];
  }
  const u = (t - 0.75) / 0.25;
  return [0.08 - u * 0.06, 0.78, 0.48];
}
