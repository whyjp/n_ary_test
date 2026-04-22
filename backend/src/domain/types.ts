// NodeSet / hyperedge types shared across cmd entry points.
//
// A single log line is materialised as one Episode (= hyperedge). Each episode
// owns the four functional layers (L0/L1/L2/L3) defined in hyper-triplet v5.
// Roles are typed references to shared entities; reused entities are what
// creates the vertical "entity track" in the temporal-layer viz.

export type EntityKind = "player" | "device" | "location" | "npc" | "mob" | "item";

export type RoleName =
  | "actor"
  | "counterpart"
  | "mob_target"
  | "item_payload"
  | "at_location"
  | "via_device";

export interface Player { id: string; username: string; }
export interface Device { id: string; kind: string; }
export interface Location { id: string; name: string; }
export interface NPC { id: string; kind: string; }
export interface Mob { id: string; species: string; }
export interface Item { id: string; kind: string; }

export interface Role {
  role: RoleName;
  entity_id: string;
  entity_kind: EntityKind;
}

export interface Episode {
  ns_id: string;
  relation_type: string;

  // L1 — temporal / importance
  event_time: string;        // ISO-8601 UTC
  minute_bucket: number;     // floor(unix / 60)
  hour_bucket: number;       // floor(unix / 3600)
  valid_from: string;
  valid_until: string;
  importance: number;
  belief: number;
  crosses_minute: boolean;
  crosses_hour: boolean;

  // L2 — context
  activity_type: string;
  mood: string;

  // L3 — auxiliary
  community_id: string;
  source_ref: string;

  // L0 — roles
  roles: Role[];

  // Original JSON log payload (free-form game event fields).
  raw_log: Record<string, unknown>;
}

export interface Dataset {
  generated_at: string;
  seed: number;
  window_start: string;
  window_end: string;
  players: Player[];
  devices: Device[];
  locations: Location[];
  npcs: NPC[];
  mobs: Mob[];
  items: Item[];
  episodes: Episode[];
}
