import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { EntityKind } from "../types";
import { ENTITY_COLORS } from "./layout";

interface Props {
  kind: EntityKind;
  position: [number, number, number];
  // `scale` is a multiplier on the base-per-kind size. The base sizes have been
  // reduced from the first pass so 60 planes of nodes don't overwhelm the scene.
  scale?: number;
  entityId?: string;
  extra?: string;
}

const BASE: Record<EntityKind, number> = {
  player:   0.26,
  device:   0.22,
  location: 0.22,
  npc:      0.22,
  mob:      0.24,
  item:     0.18,
};

export function EntityMesh({ kind, position, scale = 1, entityId, extra }: Props) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const color = ENTITY_COLORS[kind];
  const r = BASE[kind] * scale;

  useFrame((_, dt) => {
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.35;
  });

  const geom = (() => {
    switch (kind) {
      case "player":   return <icosahedronGeometry args={[r, 1]} />;
      case "device":   return <boxGeometry args={[r * 1.3, r * 1.3, r * 1.3]} />;
      case "location": return <octahedronGeometry args={[r * 1.1, 0]} />;
      case "npc":      return <coneGeometry args={[r * 1.1, r * 2.0, 6]} />;
      case "mob":      return <tetrahedronGeometry args={[r * 1.3, 0]} />;
      case "item":     return <sphereGeometry args={[r * 0.95, 14, 14]} />;
    }
  })();

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        {geom}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.95 : 0.45}
          roughness={0.3}
          metalness={0.45}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[r * 1.75, 12, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.12 : 0.04}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {hovered && (
        <Html position={[r * 1.8, r * 1.2, 0]} zIndexRange={[100, 50]}>
          <div
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: "#eaeaf0",
              background: "rgba(8,8,12,0.94)",
              border: `1px solid #${color.toString(16).padStart(6, "0")}`,
              padding: "8px 12px",
              letterSpacing: "0.04em",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              boxShadow: `0 0 12px #${color.toString(16).padStart(6, "0")}66`,
            }}
          >
            <div style={{ color: `#${color.toString(16).padStart(6, "0")}`, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
              {kind}
            </div>
            <div><b>{entityId ?? "?"}</b></div>
            {extra && <div style={{ fontSize: 9, color: "#9898a8", marginTop: 3 }}>{extra}</div>}
          </div>
        </Html>
      )}
    </group>
  );
}
