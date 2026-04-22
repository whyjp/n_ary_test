// Build a FalkorDB property-graph representation of the SAME dataset that
// TypeDB stores as n-ary `episode` relations.
//
// Parity goal: both DBs hold an equivalent node/edge count for identical
// facts. TypeDB's n-ary `episode` relation instances are reified here as
// Episode nodes; every role binding becomes a typed edge from the Episode
// node to the participating entity node.
//
// Additionally emits a `TimePlayerHub` tier — a third schema between raw
// pair-wise and full n-ary. Each (minute_bucket, player_id) combo becomes a
// first-class hub node that CONTAINS the episodes inside its 1-minute
// window. Naive Cypher can force a shared hub variable to scope role
// references into one time+player context — reducing but not eliminating
// phantom. Two structural holes remain (see docs/README.md §4-1):
//   (a) within-hub phantom — distinct anonymous :Episodes under the same h
//       can still recombine.
//   (b) cross-hub phantom via 2+hop shared entity — the hub only binds
//       1-hop :Episode membership; shared entities (:Location, :Item, ...)
//       remain global, so a path entity→episode→entity' can bridge two
//       hubs through an intermediate entity that is NOT 1-hop from any hub.
//
// Result per 1,000 mock episodes (1 player, ~60 minute buckets):
//   nodes = 37 entities + 999 Episode nodes + ~60 Hub nodes ≈ 1,096
//   edges ≈ 3,553 role edges + 999 CONTAINS edges ≈ 4,552
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
  hubs: number;
  containsEdges: number;
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
  const stats: CypherStats = { uniqueEdges: 0, nodes: 0, byRelation: {}, hubs: 0, containsEdges: 0 };
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

  // TimePlayerHub — one node per (minute_bucket, actor_player_id). First-
  // class grouping tier: CONTAINS edges point Hub → Episode so a hub-scoped
  // Cypher query can force all :Episode references into the same 1-minute
  // time+player context. Phantom reduces to within-hub only (not eliminated).
  // Minute granularity is chosen to match the visualization's 1-min planes
  // and to keep multi-hop cartesians tractable (≈16 eps/hub vs 500 at hour).
  const hubSeen = new Set<string>();
  const hubOf = (ep: (typeof ds.episodes)[number]): string | null => {
    const actor = ep.roles.find((r) => r.role === "actor");
    if (!actor || actor.entity_kind !== "player") return null;
    return `hub-m${ep.minute_bucket}-${actor.entity_id}`;
  };
  for (const ep of ds.episodes) {
    const hubId = hubOf(ep);
    if (!hubId || hubSeen.has(hubId)) continue;
    hubSeen.add(hubId);
    const actor = ep.roles.find((r) => r.role === "actor")!;
    addNode("TimePlayerHub", hubId, {
      minute_bucket: ep.minute_bucket,
      hour_bucket: ep.hour_bucket,
      player_id: actor.entity_id,
    });
    stats.hubs++;
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

  // Hub CONTAINS Episode edges.
  for (const ep of ds.episodes) {
    const hubId = hubOf(ep);
    if (!hubId) continue;
    edgeQueries.push(
      `MATCH (h:TimePlayerHub {id: '${q(hubId)}'}), (e:Episode {id: '${q(ep.ns_id)}'}) ` +
      `CREATE (h)-[:CONTAINS]->(e)`,
    );
    stats.containsEdges++;
  }

  return { nodeQueries, edgeQueries, stats };
}
