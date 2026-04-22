// Build a FalkorDB property-graph representation of the SAME dataset that
// TypeDB stores as n-ary `episode` relations.
//
// Parity goal: both DBs hold an equivalent node/edge count for identical
// facts. TypeDB's n-ary `episode` relation instances are reified here as
// Episode nodes; every role binding becomes a typed edge from the Episode
// node to the participating entity node.
//
// Result per 1,000 mock episodes:
//   nodes = 37 entities + 999 Episode nodes = 1,036
//   edges ≈ 3,553 role edges (one per role binding — NOT deduplicated)
//
// The leakage cases then exercise the classic pair-wise pitfall: a Cypher
// query that forgets to constrain all role references to the SAME Episode
// node freely re-combines bindings from different episodes. Compared to
// TypeDB's n-ary schema — where a single `episode` relation variable
// intrinsically carries episode identity — the triplet graph requires the
// query author's discipline, not the schema's.

import type { Dataset } from "../domain/types.ts";

export interface CypherStats {
  uniqueEdges: number;
  nodes: number;
  byRelation: Record<string, number>;
}

function q(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Canonical role edge labels mirror TypeDB's role names.
const ROLE_EDGE: Record<string, string> = {
  actor:         "ACTOR",
  counterpart:   "COUNTERPART",
  mob_target:    "MOB_TARGET",
  item_payload:  "ITEM_PAYLOAD",
  at_location:   "AT_LOCATION",
  via_device:    "VIA_DEVICE",
};

const KIND_LABEL: Record<string, string> = {
  player: "Player", device: "Device", location: "Location",
  npc: "NPC", mob: "Mob", item: "Item",
};

export function buildCypher(ds: Dataset): {
  nodeQueries: string[];
  edgeQueries: string[];
  stats: CypherStats;
} {
  const stats: CypherStats = { uniqueEdges: 0, nodes: 0, byRelation: {} };
  const nodeQueries: string[] = [];

  const addNode = (label: string, id: string, props: Record<string, string | number | boolean>) => {
    const parts = Object.entries(props).map(([k, v]) => {
      if (typeof v === "string") return `${k}: '${q(v)}'`;
      return `${k}: ${v}`;
    });
    nodeQueries.push(`MERGE (n:${label} {id: '${q(id)}'}) SET n += {${parts.join(", ")}}`);
    stats.nodes++;
  };

  // Entities — identical to TypeDB's entity catalogue.
  for (const p of ds.players)   addNode("Player",   p.id, { username: p.username });
  for (const d of ds.devices)   addNode("Device",   d.id, { kind: d.kind });
  for (const l of ds.locations) addNode("Location", l.id, { name: l.name });
  for (const n of ds.npcs)      addNode("NPC",      n.id, { kind: n.kind });
  for (const m of ds.mobs)      addNode("Mob",      m.id, { species: m.species });
  for (const i of ds.items)     addNode("Item",     i.id, { kind: i.kind });

  // Episode reification nodes — one per TypeDB episode instance.
  for (const ep of ds.episodes) {
    addNode("Episode", ep.ns_id, {
      relation_type:  ep.relation_type,
      event_time:     ep.event_time,
      minute_bucket:  ep.minute_bucket,
      hour_bucket:    ep.hour_bucket,
      valid_from:     ep.valid_from,
      valid_until:    ep.valid_until,
      importance:     ep.importance,
      belief:         ep.belief,
      crosses_minute: ep.crosses_minute,
      crosses_hour:   ep.crosses_hour,
      activity_type:  ep.activity_type,
      mood:           ep.mood,
      community_id:   ep.community_id,
      source_ref:     ep.source_ref,
    });
  }

  // Role edges Episode → Entity. NO dedup — a role binding that repeats
  // across episodes gets a fresh edge each time, matching TypeDB's per-
  // episode role instance count.
  const edgeQueries: string[] = [];
  const edge = (role: string, epId: string, kind: string, entityId: string) => {
    const label = ROLE_EDGE[role];
    const entityLabel = KIND_LABEL[kind];
    if (!label || !entityLabel) return;
    edgeQueries.push(
      `MATCH (e:Episode {id: '${q(epId)}'}), (x:${entityLabel} {id: '${q(entityId)}'}) ` +
      `CREATE (e)-[:${label}]->(x)`,
    );
    stats.uniqueEdges++;
    stats.byRelation[label] = (stats.byRelation[label] ?? 0) + 1;
  };

  for (const ep of ds.episodes) {
    for (const r of ep.roles) edge(r.role, ep.ns_id, r.entity_kind, r.entity_id);
  }

  return { nodeQueries, edgeQueries, stats };
}
