// Shared types — mirror of backend/src/domain/types.ts.

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
  event_time: string;
  minute_bucket: number;
  hour_bucket: number;
  valid_from: string;
  valid_until: string;
  importance: number;
  belief: number;
  crosses_minute: boolean;
  crosses_hour: boolean;
  activity_type: string;
  mood: string;
  community_id: string;
  source_ref: string;
  roles: Role[];
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

export type ViewMode = "minute" | "hour";

export interface Filters {
  relationType: string | null;
  activityType: string | null;
  touchEntity: string | null;
  onlyCrossBoundary: boolean;
  minImportance: number;
}
