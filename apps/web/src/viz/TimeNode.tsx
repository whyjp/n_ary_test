import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  y: number;
  label: string;
  episodeCount: number;
  crossBoundaryCount: number;
  // Player username displayed in hover — this node is the merged (time × player)
  // anchor since the entire graph is single-player.
  playerId: string;
  playerUsername: string;
  // Colour of the owning plane (from tierColor) — the node fades in sync.
  color: THREE.Color;
}

// Visual language: a double-ring torus + small core sphere at the plane's
// centre. The torus sits on the plane surface so it reads as "the clock for
// this slice", while the core is the implicit player anchor point.
export function TimeNode({ y, label, episodeCount, crossBoundaryCount, playerId, playerUsername, color }: Props) {
  const coreRef = useRef<THREE.Mesh>(null!);
  const torusRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const hex = "#" + color.getHexString();

  useFrame((_, dt) => {
    if (coreRef.current) coreRef.current.rotation.y += dt * 0.6;
    if (torusRef.current) torusRef.current.rotation.z += dt * 0.25;
  });

  return (
    <group position={[0, y, 0]}>
      {/* Core */}
      <mesh
        ref={coreRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <icosahedronGeometry args={[0.36, 1]} />
        <meshStandardMaterial
          color={0x2de8c8}
          emissive={0x2de8c8}
          emissiveIntensity={hovered ? 1.1 : 0.75}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>

      {/* Outer torus flush with the plane surface, inheriting the tier color */}
      <mesh ref={torusRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.85, 0.04, 8, 48]} />
        <meshBasicMaterial color={color} transparent opacity={hovered ? 0.9 : 0.55} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.15, 0.02, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={hovered ? 0.5 : 0.22} depthWrite={false} />
      </mesh>

      {/* Additive halo around core */}
      <mesh>
        <sphereGeometry args={[0.7, 16, 16]} />
        <meshBasicMaterial
          color={0x2de8c8}
          transparent
          opacity={hovered ? 0.18 : 0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {hovered && (
        <Html position={[1.5, 0.4, 0]} zIndexRange={[120, 80]}>
          <div
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: "#eaeaf0",
              background: "rgba(8,8,12,0.94)",
              border: `1px solid ${hex}`,
              padding: "10px 14px",
              minWidth: 200,
              letterSpacing: "0.04em",
              pointerEvents: "none",
              boxShadow: `0 0 16px ${hex}77`,
            }}
          >
            <div style={{ color: "#2de8c8", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 6 }}>
              time × player node
            </div>
            <div style={{ marginBottom: 3 }}>slice: <b style={{ color: hex }}>{label}</b></div>
            <div style={{ marginBottom: 3 }}>player: <b>{playerId}</b> · {playerUsername}</div>
            <div style={{ marginBottom: 3 }}>episodes: <b>{episodeCount}</b></div>
            <div>cross-boundary: <b style={{ color: "var(--accent-pg)" }}>{crossBoundaryCount}</b></div>
            <div style={{ fontSize: 9, color: "#7a7a8a", marginTop: 6 }}>
              actor role for every episode in this slice anchors here.
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
