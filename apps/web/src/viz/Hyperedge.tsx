import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  // Positions ALREADY in world space. For cross-boundary episodes each role
  // player appears at a different y, so the triangle-fan mesh is a prism that
  // pierces multiple planes instead of sitting flat on one.
  positions: [number, number, number][];
  color: number;
  dim?: boolean;
  // When true, the edge is a hyperedge that spans >1 plane — amplify perimeter
  // so the "single mesh piercing planes" story reads at a glance.
  crossing?: boolean;
}

export function Hyperedge({ positions, color, dim = false, crossing = false }: Props) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  const geometry = useMemo(() => {
    if (positions.length < 2) return null;

    const centroid = new THREE.Vector3();
    positions.forEach((p) => centroid.add(new THREE.Vector3(...p)));
    centroid.divideScalar(positions.length);

    if (positions.length === 2) {
      const g = new THREE.BufferGeometry();
      g.setFromPoints([new THREE.Vector3(...positions[0]!), new THREE.Vector3(...positions[1]!)]);
      return { kind: "line" as const, g, centroid };
    }

    const rel = positions.map((p) => new THREE.Vector3(...p).sub(centroid));
    const sorted = positions
      .map((p, i) => ({ p, i, angle: Math.atan2(rel[i]!.x, rel[i]!.z) }))
      .sort((a, b) => a.angle - b.angle)
      .map((o) => o.p);

    const verts: number[] = [];
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const a = sorted[i]!;
      const b = sorted[(i + 1) % n]!;
      verts.push(centroid.x, centroid.y, centroid.z);
      verts.push(a[0], a[1], a[2]);
      verts.push(b[0], b[1], b[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();

    const linePts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) linePts.push(new THREE.Vector3(...sorted[i % n]!));
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePts);

    const spokePts: THREE.Vector3[] = [];
    for (const p of sorted) {
      spokePts.push(centroid.clone());
      spokePts.push(new THREE.Vector3(...p));
    }
    const spokeGeom = new THREE.BufferGeometry().setFromPoints(spokePts);

    return { kind: "poly" as const, g, lineGeom, spokeGeom, centroid };
  }, [positions]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    const pulse = 0.9 + Math.sin(phase + t * 0.7) * 0.1;
    // NormalBlending + low opacity — many overlapping edges compose to a
    // smoky look rather than saturating to white like additive blending did.
    const baseOpacity = dim ? 0.035 : crossing ? 0.16 : 0.1;
    if (matRef.current) matRef.current.opacity = baseOpacity * pulse;
    groupRef.current.scale.setScalar(0.98 + Math.sin(phase + t * 0.7) * 0.02);
  });

  if (!geometry) return null;

  const edgeColor = new THREE.Color(color);
  const perimeterOpacity = dim ? 0.18 : crossing ? 0.92 : 0.6;
  const spokeOpacity = dim ? 0.06 : crossing ? 0.3 : 0.14;

  if (geometry.kind === "line") {
    return (
      <group ref={groupRef}>
        <line>
          <primitive object={geometry.g} attach="geometry" />
          <lineBasicMaterial color={edgeColor} transparent opacity={perimeterOpacity} />
        </line>
        {crossing && (
          <line>
            <primitive object={geometry.g} attach="geometry" />
            {/* Very low additive halo — kept to signal "this crosses planes"
                but not stack into white when hundreds overlap. */}
            <lineBasicMaterial color={0xffffff} transparent opacity={0.08} blending={THREE.AdditiveBlending} />
          </line>
        )}
      </group>
    );
  }

  return (
    <group ref={groupRef}>
      <mesh>
        <primitive object={geometry.g} attach="geometry" />
        <meshBasicMaterial
          ref={matRef}
          color={edgeColor}
          transparent
          opacity={dim ? 0.035 : crossing ? 0.16 : 0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <primitive object={geometry.lineGeom} attach="geometry" />
        <lineBasicMaterial color={edgeColor} transparent opacity={perimeterOpacity} />
      </lineSegments>
      {crossing && (
        <lineSegments>
          <primitive object={geometry.lineGeom} attach="geometry" />
          <lineBasicMaterial color={0xffffff} transparent opacity={0.1} blending={THREE.AdditiveBlending} />
        </lineSegments>
      )}
      <lineSegments>
        <primitive object={geometry.spokeGeom} attach="geometry" />
        <lineBasicMaterial color={edgeColor} transparent opacity={spokeOpacity} />
      </lineSegments>
    </group>
  );
}
