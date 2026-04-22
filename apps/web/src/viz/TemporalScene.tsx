import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

import type { Dataset, Episode, EntityKind, Filters, ViewMode } from "../types";
import { xzFor, relationColor, tierColorHSL } from "./layout";
import { PlaneLayer } from "./PlaneLayer";
import { Hyperedge } from "./Hyperedge";
import { EntityMesh } from "./EntityMesh";
import { TimeNode } from "./TimeNode";

interface Props {
  dataset: Dataset;
  viewMode: ViewMode;
  filters: Filters;
  // User-controlled multiplier on the vertical spacing between planes.
  spacingMult: number;
  nodeScale: number;
  // Optional highlight set (ns_ids from natural-language narrative query).
  // When non-null, episodes inside the set render full-intensity, others fade.
  highlightNsIds: Set<string> | null;
}

interface BucketInfo {
  key: number;
  label: string;
  episodes: Episode[];
}

const SLAB_RADIUS = 12;

// Build time-bucket collections and vertical spacing.
function groupBuckets(ds: Dataset, mode: ViewMode): BucketInfo[] {
  const getBucket = (e: Episode) => (mode === "minute" ? e.minute_bucket : e.hour_bucket);
  const start = new Date(ds.window_start).getTime() / 1000;
  const firstBucket = mode === "minute" ? Math.floor(start / 60) : Math.floor(start / 3600);
  const lastEpisodeTime = new Date(ds.window_end).getTime() / 1000;
  const lastBucket = mode === "minute" ? Math.floor(lastEpisodeTime / 60) : Math.floor(lastEpisodeTime / 3600);

  const buckets: BucketInfo[] = [];
  const map = new Map<number, Episode[]>();
  for (const e of ds.episodes) {
    const k = getBucket(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }

  for (let k = firstBucket; k <= lastBucket; k++) {
    const episodes = map.get(k) ?? [];
    const date = new Date((mode === "minute" ? k * 60 : k * 3600) * 1000);
    const yyyy = date.getUTCHours().toString().padStart(2, "0");
    const mi = date.getUTCMinutes().toString().padStart(2, "0");
    const label = mode === "minute" ? `${yyyy}:${mi}` : `${yyyy}:00`;
    buckets.push({ key: k, label, episodes });
  }
  return buckets;
}

function applyFilters(ep: Episode, f: Filters): boolean {
  if (f.relationType && ep.relation_type !== f.relationType) return false;
  if (f.activityType && ep.activity_type !== f.activityType) return false;
  if (f.touchEntity && !ep.roles.some((r) => r.entity_id === f.touchEntity)) return false;
  if (f.onlyCrossBoundary && !(ep.crosses_minute || ep.crosses_hour)) return false;
  if (ep.importance < f.minImportance) return false;
  return true;
}

export function TemporalScene({ dataset, viewMode, filters, spacingMult, nodeScale, highlightNsIds }: Props) {
  const buckets = useMemo(() => groupBuckets(dataset, viewMode), [dataset, viewMode]);

  // Spacing: tight for 60-minute view, loose for 2-hour; user multiplier on top.
  const baseSpacing = viewMode === "minute" ? 0.9 : 5.5;
  const spacing = baseSpacing * spacingMult;
  const total = buckets.length;
  const yForBucket = (idx: number) => -((total - 1) * spacing) / 2 + idx * spacing;

  const bucketIdxByKey = useMemo(() => {
    const m = new Map<number, number>();
    buckets.forEach((b, i) => m.set(b.key, i));
    return m;
  }, [buckets]);

  // Collect unique (entity,bucket) pairs. We skip players intentionally —
  // the single player is collapsed into the plane's TimeNode (time × player
  // merged concept), so actor role anchors visually to the plane centre.
  const entityPositions = useMemo(() => {
    const map = new Map<string, { kind: EntityKind; pos: [number, number, number] }>();
    for (const b of buckets) {
      const y = yForBucket(bucketIdxByKey.get(b.key)!);
      for (const ep of b.episodes) {
        for (const r of ep.roles) {
          if (r.entity_kind === "player") continue; // absorbed into TimeNode
          const key = `${r.entity_id}|${b.key}`;
          if (!map.has(key)) {
            const [x, z] = xzFor(r.entity_id, r.entity_kind);
            map.set(key, { kind: r.entity_kind, pos: [x, y, z] });
          }
        }
      }
    }
    return map;
  }, [buckets, spacing]);

  // Hyperedges: each episode is rendered once. Roles come from its own bucket,
  // but if crosses_minute/hour and we're in the matching view, role players
  // get stretched to whatever bucket their valid_from / valid_until lands in —
  // producing a single mesh that pierces multiple planes.
  function hyperedgeFor(ep: Episode): [number, number, number][] {
    const primaryKey = viewMode === "minute" ? ep.minute_bucket : ep.hour_bucket;
    const primaryIdx = bucketIdxByKey.get(primaryKey);
    if (primaryIdx === undefined) return [];
    const primaryY = yForBucket(primaryIdx);

    const positions: [number, number, number][] = [];
    const crosses = viewMode === "minute" ? ep.crosses_minute : ep.crosses_hour;
    const tailKey = (() => {
      const tail = Math.floor(new Date(ep.valid_until).getTime() / 1000);
      return viewMode === "minute" ? Math.floor(tail / 60) : Math.floor(tail / 3600);
    })();
    const tailIdx = bucketIdxByKey.get(tailKey);
    const tailY = tailIdx !== undefined ? yForBucket(tailIdx) : primaryY;

    for (let i = 0; i < ep.roles.length; i++) {
      const r = ep.roles[i]!;
      // Actor (player) role anchors at the plane's TimeNode (origin).
      if (r.entity_kind === "player") {
        positions.push([0, primaryY, 0]);
        continue;
      }
      const [x, z] = xzFor(r.entity_id, r.entity_kind);
      // Distribute the non-actor role players across [primaryY, tailY] when
      // crossing so the triangle-fan tilts through the planes.
      let y = primaryY;
      if (crosses && tailIdx !== undefined && tailIdx !== primaryIdx) {
        const frac = ep.roles.length === 1 ? 0 : i / (ep.roles.length - 1);
        y = primaryY + (tailY - primaryY) * frac;
      }
      positions.push([x, y, z]);
    }
    return positions;
  }

  // Determine which episode is "active" — passes filters.
  const activeCount = useMemo(
    () => dataset.episodes.filter((e) => applyFilters(e, filters)).length,
    [dataset.episodes, filters],
  );

  return (
    <Canvas camera={{ position: [20, 12, 26], fov: 40 }} gl={{ antialias: true }}>
      <color attach="background" args={[0x08080c]} />
      <fog attach="fog" args={[0x08080c, 30, 140]} />
      <ambientLight color={0x404050} intensity={0.6} />
      <pointLight color={0x2de8c8} intensity={1.0} distance={120} position={[-15, 20, 12]} />
      <pointLight color={0xff6b9d} intensity={0.5} distance={100} position={[15, -10, -12]} />
      <pointLight color={0xffb347} intensity={0.6} distance={100} position={[0, 30, 0]} />

      <Stars radius={80} depth={40} count={900} factor={3} fade speed={0.3} />

      {buckets.map((b, idx) => {
        const y = yForBucket(idx);
        const t = total <= 1 ? 1 : idx / (total - 1);
        const [h, s, l] = tierColorHSL(t);
        const col = new THREE.Color().setHSL(h, s, l);
        const xCount = b.episodes.filter((e) => e.crosses_minute || e.crosses_hour).length;
        const primaryPlayer = dataset.players[0];
        return (
          <group key={b.key}>
            <PlaneLayer
              y={y}
              radius={SLAB_RADIUS}
              color={col}
              label={b.label}
              compact={viewMode === "minute"}
              episodeCount={b.episodes.length}
              crossBoundaryCount={xCount}
            />
            {primaryPlayer && (
              <TimeNode
                y={y}
                label={b.label}
                episodeCount={b.episodes.length}
                crossBoundaryCount={xCount}
                playerId={primaryPlayer.id}
                playerUsername={primaryPlayer.username}
                color={col}
              />
            )}
          </group>
        );
      })}

      {/* Entities — one mesh per (entity,bucket) touched. */}
      {Array.from(entityPositions.entries()).map(([key, v]) => {
        const entityId = key.split("|")[0]!;
        return (
          <EntityMesh
            key={key}
            kind={v.kind}
            position={v.pos}
            scale={nodeScale * (viewMode === "minute" ? 0.85 : 1)}
            entityId={entityId}
          />
        );
      })}

      {/* Hyperedges — filtered/highlighted episodes at full intensity, others
          dim. If a narrative highlight set is present, it overrides the normal
          filter-based dimming (so "show me X" immediately isolates X). */}
      {dataset.episodes.map((ep) => {
        const positions = hyperedgeFor(ep);
        if (positions.length < 2) return null;
        const passesFilter = applyFilters(ep, filters);
        const active = highlightNsIds
          ? highlightNsIds.has(ep.ns_id)
          : passesFilter;
        const crossing = viewMode === "minute" ? ep.crosses_minute : ep.crosses_hour;
        return (
          <Hyperedge
            key={ep.ns_id}
            positions={positions}
            color={relationColor(ep.relation_type)}
            dim={!active}
            crossing={crossing}
          />
        );
      })}

      {/* Vertical entity track — dashed column from first to last bucket
          the entity appears in (only in hour view to avoid clutter). */}
      {viewMode === "hour" && (
        <EntityTracks
          dataset={dataset}
          spacing={spacing}
          total={total}
          bucketIdxByKey={bucketIdxByKey}
        />
      )}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={14}
        maxDistance={100}
        autoRotate
        autoRotateSpeed={0.35}
      />

      {/* HUD overlay count of visible episodes — placed as Drei Html elsewhere
          (in the side panel). Nothing else needed here. */}
      <ActiveCountBeacon count={activeCount} />
    </Canvas>
  );
}

function ActiveCountBeacon({ count }: { count: number }) {
  // Small invisible marker — actual count rendered in the sidebar.
  return null;
}

function EntityTracks({
  dataset,
  spacing,
  total,
  bucketIdxByKey,
}: {
  dataset: Dataset;
  spacing: number;
  total: number;
  bucketIdxByKey: Map<number, number>;
}) {
  const tracks = useMemo(() => {
    const appear = new Map<string, { kind: EntityKind; indices: Set<number> }>();
    for (const ep of dataset.episodes) {
      const idx = bucketIdxByKey.get(ep.hour_bucket);
      if (idx === undefined) continue;
      for (const r of ep.roles) {
        if (!appear.has(r.entity_id)) {
          appear.set(r.entity_id, { kind: r.entity_kind, indices: new Set() });
        }
        appear.get(r.entity_id)!.indices.add(idx);
      }
    }
    const yFor = (idx: number) => -((total - 1) * spacing) / 2 + idx * spacing;
    const out: { id: string; kind: EntityKind; low: number; high: number; xz: [number, number] }[] = [];
    for (const [id, v] of appear) {
      if (v.indices.size < 2) continue;
      const arr = [...v.indices].sort((a, b) => a - b);
      out.push({
        id,
        kind: v.kind,
        low: yFor(arr[0]!),
        high: yFor(arr[arr.length - 1]!),
        xz: xzFor(id, v.kind),
      });
    }
    return out;
  }, [dataset, spacing, total, bucketIdxByKey]);

  return (
    <group>
      {tracks.map((t) => {
        const pts = [
          new THREE.Vector3(t.xz[0], t.low, t.xz[1]),
          new THREE.Vector3(t.xz[0], t.high, t.xz[1]),
        ];
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        return (
          <line key={t.id}>
            <primitive object={g} attach="geometry" />
            <lineBasicMaterial color={0xaaaaaa} transparent opacity={0.15} />
          </line>
        );
      })}
    </group>
  );
}
