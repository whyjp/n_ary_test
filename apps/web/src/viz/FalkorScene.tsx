import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import * as THREE from "three";

import type { EntityKind } from "../types";
import { ENTITY_COLORS, relationColor, xzFor } from "./layout";
import { fetchFalkorGraph, type FalkorGraphEdge, type FalkorGraphNode } from "../api";
import { EntityMesh } from "./EntityMesh";

// FalkorDB triplet relation type → render colour. We re-use the hyperedge
// palette where possible so colours read consistently across both scenes.
const EDGE_COLOR: Record<string, number> = {
  USED_ITEM: 0x94a3b8,
  ITEM_AT_LOCATION: 0x60a5fa,
  PLAYER_AT_LOCATION: 0x2de8c8,
  PLAYER_WITH_COUNTERPART: 0xff6b9d,
  COUNTERPART_AT_LOCATION: 0xa78bfa,
  PLAYER_KILLED_MOB: 0xff6b6b,
  MOB_AT_LOCATION: 0xf87171,
  PLAYER_VIA_DEVICE: 0xffb347,
};

const LABEL_TO_KIND: Record<string, EntityKind> = {
  Player: "player", Device: "device", Location: "location",
  NPC: "npc",       Mob: "mob",       Item: "item",
};

interface Props {
  nodeScale: number;
}

function EdgeLine({ a, b, color }: { a: [number, number, number]; b: [number, number, number]; color: number }) {
  const ref = useRef<THREE.Line>(null!);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame((s) => {
    if (!ref.current) return;
    const t = s.clock.getElapsedTime();
    (ref.current.material as THREE.LineBasicMaterial).opacity =
      0.55 + Math.sin(phase + t * 0.6) * 0.15;
  });
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    return g;
  }, [a[0], a[1], a[2], b[0], b[1], b[2]]);
  return (
    <line ref={ref as any}>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={0.7} />
    </line>
  );
}

export function FalkorScene({ nodeScale }: Props) {
  const [nodes, setNodes] = useState<FalkorGraphNode[]>([]);
  const [edges, setEdges] = useState<FalkorGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchFalkorGraph().then((g) => {
      if (!alive) return;
      if (!g.falkor_available) setErrored(true);
      setNodes(g.nodes); setEdges(g.edges); setLoading(false);
    }).catch(() => { if (alive) { setErrored(true); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // Fixed-y placement for the triplet graph — NO time axis.
  const layerY = 0;
  const positions = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const n of nodes) {
      const kind = LABEL_TO_KIND[n.label] ?? "item";
      const [x, z] = xzFor(n.id, kind);
      m.set(n.id, [x, layerY, z]);
    }
    return m;
  }, [nodes]);

  if (loading || errored) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "var(--mono)", fontSize: 12,
        color: errored ? "var(--accent-red)" : "var(--text-faint)",
      }}>
        {errored ? "FalkorDB 그래프 로드 실패 — load-falkor.ts 실행 확인" : "FalkorDB 그래프 로드 중…"}
      </div>
    );
  }

  return (
    <Canvas camera={{ position: [22, 16, 22], fov: 42 }} gl={{ antialias: true }}>
      <color attach="background" args={[0x08080c]} />
      <fog attach="fog" args={[0x08080c, 30, 140]} />
      <ambientLight color={0x404050} intensity={0.7} />
      <pointLight color={0xffb347} intensity={1.0} distance={120} position={[12, 18, 10]} />
      <pointLight color={0x2de8c8} intensity={0.6} distance={100} position={[-12, -4, -12]} />

      <Stars radius={80} depth={40} count={700} factor={3} fade speed={0.3} />

      {/* A single grounding ring — visually reinforces "no time axis". */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, layerY, 0]}>
        <ringGeometry args={[12.3, 12.4, 96]} />
        <meshBasicMaterial color={0xffb347} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[-13.2, layerY, 0]} zIndexRange={[50, 0]}>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
          color: "#ffb347", padding: "3px 10px",
          background: "rgba(8,8,12,0.85)", border: "0.5px solid #ffb34766",
          letterSpacing: "0.16em", textTransform: "uppercase",
          whiteSpace: "nowrap", pointerEvents: "none",
        }}>TRIPLET · NO TIME AXIS · {edges.length} edges</div>
      </Html>

      {/* Entity nodes */}
      {nodes.map((n) => {
        const pos = positions.get(n.id) ?? [0, 0, 0];
        const kind = LABEL_TO_KIND[n.label] ?? "item";
        return (
          <EntityMesh
            key={n.id}
            kind={kind}
            position={pos}
            scale={nodeScale * 1.1}
            entityId={n.id}
            extra={n.label}
          />
        );
      })}

      {/* Pair-wise edges */}
      {edges.map((e, i) => {
        const a = positions.get(e.src);
        const b = positions.get(e.dst);
        if (!a || !b) return null;
        return <EdgeLine key={`${e.type}-${e.src}-${e.dst}-${i}`} a={a} b={b} color={EDGE_COLOR[e.type] ?? relationColor(e.type)} />;
      })}

      <OrbitControls
        enableDamping dampingFactor={0.05}
        minDistance={12} maxDistance={70}
        autoRotate autoRotateSpeed={0.25}
      />
    </Canvas>
  );
}
