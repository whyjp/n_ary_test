import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";

interface Props {
  y: number;
  radius: number;
  color: THREE.Color;
  label: string;
  // `compact` shrinks the ring to a subtle outline for the 60-plane minute view.
  compact?: boolean;
  episodeCount: number;
  crossBoundaryCount?: number;
}

export function PlaneLayer({ y, radius, color, label, compact = false, episodeCount, crossBoundaryCount = 0 }: Props) {
  const hex = "#" + color.getHexString();
  const [hovered, setHovered] = useState(false);

  // Desaturate the plane ring — the old version was near-white because of
  // tier HSL values + additive bloom. Now: a thin darker ring only.
  const ringInner = compact ? radius * 0.995 : radius * 0.985;
  const ringOpacity = compact ? 0.18 : 0.28;

  return (
    <group position={[0, y, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <ringGeometry args={[ringInner, radius, 96]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? ringOpacity * 2.2 : ringOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Time label on the left edge — always rendered, small. */}
      <Html position={[-radius - 0.5, 0.0, 0]} zIndexRange={[50, 0]}>
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: compact ? "8.5px" : "10px",
            fontWeight: 500,
            color: hex,
            padding: "2px 8px",
            background: "rgba(8,8,12,0.85)",
            border: `0.5px solid ${hex}66`,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            opacity: hovered ? 1 : (compact ? 0.7 : 0.9),
          }}
        >
          {label} · {episodeCount}
        </div>
      </Html>

      {/* Hover tooltip — richer detail. */}
      {hovered && (
        <Html position={[radius + 0.5, 0.0, 0]} zIndexRange={[100, 50]}>
          <div
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: "#eaeaf0",
              background: "rgba(8,8,12,0.94)",
              border: `1px solid ${hex}`,
              padding: "10px 14px",
              minWidth: 180,
              letterSpacing: "0.04em",
              pointerEvents: "none",
              boxShadow: `0 0 16px ${hex}66`,
            }}
          >
            <div style={{ color: hex, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
              plane · {label}
            </div>
            <div style={{ marginBottom: 3 }}>episodes: <b>{episodeCount}</b></div>
            <div style={{ marginBottom: 3 }}>cross-boundary: <b style={{ color: "var(--accent-pg)" }}>{crossBoundaryCount}</b></div>
            <div style={{ fontSize: 9, color: "#7a7a8a", marginTop: 6 }}>y = {y.toFixed(2)}</div>
          </div>
        </Html>
      )}
    </group>
  );
}
