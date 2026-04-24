// TypeDB 3.x HTTP client. Uses the built-in HTTP API (default host port 28000) so
// the project depends only on `fetch`, not on a native driver. Auth is the
// out-of-the-box CE credentials (admin / password); override via env vars.
//
// API endpoints used (TypeDB 3.x):
//   POST /v1/signin                                          -> { token }
//   POST /v1/databases/{db}/transactions/{read|write}/query  -> { answerType, answers }
//   GET  /v1/databases                                       -> [ { name }, ... ]

import type { Dataset, Episode, EntityKind, Role, RoleName } from "../domain/types.ts";

const HTTP_BASE = process.env.TYPEDB_HTTP ?? "http://localhost:28000";
const DATABASE  = process.env.TYPEDB_DATABASE ?? "n_ary";
const USER      = process.env.TYPEDB_USER ?? "admin";
const PASSWORD  = process.env.TYPEDB_PASSWORD ?? "password";

let cachedToken: { token: string; exp: number } | null = null;

async function signIn(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  const res = await fetch(`${HTTP_BASE}/v1/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`TypeDB signin failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  cachedToken = { token: body.token, exp: Date.now() + 20 * 60 * 1000 };
  return body.token;
}

async function runQueryHTTP(
  tql: string,
  mode: "read" | "write" | "schema" = "read",
): Promise<{ answerType: string; answers: any[]; queryType?: string }> {
  const token = await signIn();
  const res = await fetch(`${HTTP_BASE}/v1/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      databaseName: DATABASE,
      query: tql,
      transactionType: mode,
      commit: mode !== "read",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`TypeDB query failed (${res.status}): ${txt}`);
  }
  const body = (await res.json()) as { answerType: string; answers: any[] | null; queryType?: string };
  return { ...body, answers: body.answers ?? [] };
}

// answerType "conceptRows": each answer is { data: { varName: Concept, ... } }
// Concept layout varies; we extract .value for attributes and the full payload
// for entities/relations. Wrappers below normalise access.

function val(concept: any): any {
  if (concept == null) return null;
  if (concept.value !== undefined) return concept.value;
  if (concept.valueType !== undefined && concept.value !== undefined) return concept.value;
  if (concept.kind === "attribute") return concept.value;
  return concept;
}

function asString(c: any): string { const v = val(c); return v == null ? "" : String(v); }
function asNumber(c: any): number { const v = val(c); return typeof v === "bigint" ? Number(v) : Number(v); }
function asBool(c: any): boolean { return Boolean(val(c)); }
function asDate(c: any): string {
  const v = val(c);
  if (v == null) return new Date(0).toISOString();
  if (v instanceof Date) return v.toISOString();
  let s = String(v);
  // TypeDB 3 `datetime` has no zone suffix — treat as UTC rather than the
  // host's local time zone so buckets and valid_from/until line up with what
  // the generator produced.
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + "Z";
  return new Date(s).toISOString();
}

async function queryEntities(
  kind: EntityKind,
  keyAttr: string,
  auxAttr: string,
): Promise<Array<{ id: string; aux: string }>> {
  const tql = `match $x isa ${kind}, has ${keyAttr} $k, has ${auxAttr} $a; select $k, $a;`;
  const r = await runQueryHTTP(tql, "read");
  return r.answers.map((a) => ({
    id: asString(a.data?.k),
    aux: asString(a.data?.a),
  }));
}

async function queryEpisodeAttrs(): Promise<Map<string, Omit<Episode, "roles" | "raw_log">>> {
  const tql = `
match
  $e isa episode,
    has ns_id $ns,
    has relation_type $rt,
    has event_time $et,
    has minute_bucket $mb,
    has hour_bucket $hb,
    has valid_from $vf,
    has valid_until $vu,
    has importance $imp,
    has belief $bf,
    has crosses_minute $cm,
    has crosses_hour $ch,
    has activity_type $at,
    has mood $mo,
    has community_id $ci,
    has source_ref $sr;
select $ns, $rt, $et, $mb, $hb, $vf, $vu, $imp, $bf, $cm, $ch, $at, $mo, $ci, $sr;`;
  const r = await runQueryHTTP(tql, "read");
  const map = new Map<string, Omit<Episode, "roles" | "raw_log">>();
  for (const a of r.answers) {
    const d = a.data ?? a;
    const nsId = asString(d.ns);
    map.set(nsId, {
      ns_id: nsId,
      relation_type: asString(d.rt),
      event_time: asDate(d.et),
      minute_bucket: asNumber(d.mb),
      hour_bucket: asNumber(d.hb),
      valid_from: asDate(d.vf),
      valid_until: asDate(d.vu),
      importance: asNumber(d.imp),
      belief: asNumber(d.bf),
      crosses_minute: asBool(d.cm),
      crosses_hour: asBool(d.ch),
      activity_type: asString(d.at),
      mood: asString(d.mo),
      community_id: asString(d.ci),
      source_ref: asString(d.sr),
    });
  }
  return map;
}

interface RoleSlice {
  ns_id: string;
  role: RoleName;
  entity_id: string;
  entity_kind: EntityKind;
}

async function queryRoles(): Promise<RoleSlice[]> {
  const specs: Array<{ role: RoleName; kind: EntityKind; keyAttr: string }> = [
    { role: "actor",        kind: "player",   keyAttr: "player_id"   },
    { role: "counterpart",  kind: "npc",      keyAttr: "npc_id"      },
    { role: "mob_target",   kind: "mob",      keyAttr: "mob_id"      },
    { role: "item_payload", kind: "item",     keyAttr: "item_id"     },
    { role: "at_location",  kind: "location", keyAttr: "location_id" },
    { role: "via_device",   kind: "device",   keyAttr: "device_id"   },
  ];
  const slices: RoleSlice[] = [];
  for (const s of specs) {
    const tql = `
match
  $e isa episode, has ns_id $ns;
  $x isa ${s.kind}, has ${s.keyAttr} $xid;
  $e links (${s.role}: $x);
select $ns, $xid;`;
    const r = await runQueryHTTP(tql, "read");
    for (const a of r.answers) {
      const d = a.data ?? a;
      slices.push({
        ns_id: asString(d.ns),
        role: s.role,
        entity_id: asString(d.xid),
        entity_kind: s.kind,
      });
    }
  }
  return slices;
}

export async function fetchDataset(): Promise<Dataset> {
  const players = (await queryEntities("player",   "player_id",   "username"))
    .map((r) => ({ id: r.id, username: r.aux }));
  const devices = (await queryEntities("device",   "device_id",   "device_type"))
    .map((r) => ({ id: r.id, kind: r.aux }));
  const locations = (await queryEntities("location", "location_id", "zone_name"))
    .map((r) => ({ id: r.id, name: r.aux }));
  const npcs = (await queryEntities("npc",      "npc_id",      "npc_kind"))
    .map((r) => ({ id: r.id, kind: r.aux }));
  const mobs = (await queryEntities("mob",      "mob_id",      "mob_species"))
    .map((r) => ({ id: r.id, species: r.aux }));
  const items = (await queryEntities("item",     "item_id",     "item_kind"))
    .map((r) => ({ id: r.id, kind: r.aux }));

  const attrMap = await queryEpisodeAttrs();
  const roleSlices = await queryRoles();

  const rolesPerEp = new Map<string, Role[]>();
  for (const s of roleSlices) {
    const arr = rolesPerEp.get(s.ns_id) ?? [];
    arr.push({ role: s.role, entity_id: s.entity_id, entity_kind: s.entity_kind });
    rolesPerEp.set(s.ns_id, arr);
  }

  const episodes: Episode[] = [];
  const times: number[] = [];
  for (const [nsId, base] of attrMap) {
    const roles = rolesPerEp.get(nsId) ?? [];
    times.push(new Date(base.event_time).getTime());
    episodes.push({ ...base, roles, raw_log: {} });
  }
  episodes.sort((a, b) => a.ns_id.localeCompare(b.ns_id));

  const minTs = times.length ? Math.min(...times) : Date.now();
  const maxTs = times.length ? Math.max(...times) : Date.now();
  return {
    generated_at: new Date().toISOString(),
    seed: -1,
    window_start: new Date(minTs - (minTs % 3600000)).toISOString(),
    window_end: new Date(maxTs + 60000).toISOString(),
    players, devices, locations, npcs, mobs, items,
    episodes,
  };
}

export async function runReadQuery(tql: string): Promise<{
  ok: boolean;
  answers: number;
  sample: string[];
  error?: string;
}> {
  try {
    const r = await runQueryHTTP(tql, "read");
    const sample: string[] = [];
    for (const a of r.answers.slice(0, 5)) {
      sample.push(JSON.stringify(a.data ?? a));
    }
    return { ok: true, answers: r.answers.length, sample };
  } catch (err) {
    return { ok: false, answers: 0, sample: [], error: String(err) };
  }
}

export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_BASE}/v1/version`, { method: "GET" });
    if (res.ok) return true;
    // Fall back — server reports distribution/version at root without auth.
    const r2 = await fetch(`${HTTP_BASE}/`);
    return r2.ok;
  } catch {
    return false;
  }
}
