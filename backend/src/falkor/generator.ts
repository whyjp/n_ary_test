// Emit Cypher MERGE statements that turn the hyperedge dataset into plain
// property-graph triplets suitable for FalkorDB / Neo4j / any OpenCypher
// engine. This is the industry-standard baseline used for the cross-episode
// leakage comparison.
//
// Each emitted edge is binary and carries no episode identity.  That is the
// exact modelling choice that makes pair-wise traversal re-combine edges from
// different episodes.

import type { Dataset } from "../domain/types.ts";

export interface CypherStats {
  uniqueEdges: number;
  nodes: number;
  byRelation: Record<string, number>;
}

function q(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function buildCypher(ds: Dataset): { nodeQueries: string[]; edgeQueries: string[]; stats: CypherStats } {
  const stats: CypherStats = { uniqueEdges: 0, nodes: 0, byRelation: {} };
  const nodeQueries: string[] = [];

  const addNode = (label: string, id: string, props: Record<string, string>) => {
    const propStr = Object.entries(props)
      .map(([k, v]) => `${k}: '${q(v)}'`).join(", ");
    nodeQueries.push(`MERGE (n:${label} {id: '${q(id)}'}) SET n += {${propStr}}`);
    stats.nodes++;
  };

  for (const p of ds.players)   addNode("Player",   p.id, { username: p.username });
  for (const d of ds.devices)   addNode("Device",   d.id, { kind: d.kind });
  for (const l of ds.locations) addNode("Location", l.id, { name: l.name });
  for (const n of ds.npcs)      addNode("NPC",      n.id, { kind: n.kind });
  for (const m of ds.mobs)      addNode("Mob",      m.id, { species: m.species });
  for (const i of ds.items)     addNode("Item",     i.id, { kind: i.kind });

  type EdgeKey = `${string}|${string}|${string}`;
  const emitted = new Set<EdgeKey>();
  const edgeQueries: string[] = [];

  const edge = (type: string, aLabel: string, aId: string, bLabel: string, bId: string) => {
    const key: EdgeKey = `${type}|${aId}|${bId}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    stats.uniqueEdges++;
    stats.byRelation[type] = (stats.byRelation[type] ?? 0) + 1;
    edgeQueries.push(
      `MATCH (a:${aLabel} {id: '${q(aId)}'}), (b:${bLabel} {id: '${q(bId)}'}) ` +
      `MERGE (a)-[:${type}]->(b)`,
    );
  };

  for (const ep of ds.episodes) {
    const actor = ep.roles.find((r) => r.role === "actor")?.entity_id;
    const loc   = ep.roles.find((r) => r.role === "at_location")?.entity_id;
    const dev   = ep.roles.find((r) => r.role === "via_device")?.entity_id;
    const cps   = ep.roles.filter((r) => r.role === "counterpart").map((r) => r.entity_id);
    const mobs  = ep.roles.filter((r) => r.role === "mob_target").map((r) => r.entity_id);
    const items = ep.roles.filter((r) => r.role === "item_payload").map((r) => r.entity_id);

    if (actor && loc) edge("PLAYER_AT_LOCATION", "Player", actor, "Location", loc);
    if (actor && dev) edge("PLAYER_VIA_DEVICE",  "Player", actor, "Device",   dev);
    for (const cp of cps)  if (actor) edge("PLAYER_WITH_COUNTERPART", "Player", actor, "NPC", cp);
    for (const cp of cps)  if (loc)   edge("COUNTERPART_AT_LOCATION", "NPC",    cp,    "Location", loc);
    for (const it of items) if (actor) edge("USED_ITEM", "Player", actor, "Item", it);
    for (const it of items) if (loc)   edge("ITEM_AT_LOCATION", "Item", it, "Location", loc);
    for (const m of mobs)  if (actor) edge("PLAYER_KILLED_MOB", "Player", actor, "Mob", m);
    for (const m of mobs)  if (loc)   edge("MOB_AT_LOCATION", "Mob", m, "Location", loc);
  }

  return { nodeQueries, edgeQueries, stats };
}
