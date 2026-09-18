"use client";

import React, { useMemo, useRef, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Pitch } from "@/components/Pitch";
import { PITCH } from "@/lib/pitch";
import { useModelAvailable } from "@/lib/modelAvailability";
import { useGLTF } from "@react-three/drei";

function GlbStadiumShell() {
  const gltf = useGLTF("/models/stadium.glb");
  const root = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [gltf.scene]);
  return <primitive object={root} />;
}

function StadiumShellModel() {
  const available = useModelAvailable("/models/stadium.glb");
  if (!available) return null;
  return (
    <Suspense fallback={null}>
      <GlbStadiumShell />
    </Suspense>
  );
}

function GlbGoal({ side }: { side: 1 | -1 }) {
  const gltf = useGLTF("/models/goal.glb");
  const root = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [gltf.scene]);
  return (
    <group position={[side * (PITCH.halfX - 0.15), 0, 0]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
      <primitive object={root} />
    </group>
  );
}

function GoalModel({ side }: { side: 1 | -1 }) {
  const available = useModelAvailable("/models/goal.glb");
  if (!available) return null;
  return (
    <Suspense fallback={null}>
      <GlbGoal side={side} />
    </Suspense>
  );
}

function createNetTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(230, 236, 240, 0.85)";
  ctx.lineWidth = 1.5;
  const step = 12;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  return tex;
}

const SPONSORS = ["SNOWPITCH", "EA SPORTS", "WHITEOUT", "SP-1.12", "INTEGRITY"];

function createHoardingTexture(labels: string[]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 2048, 0);
  grad.addColorStop(0, "#0a1520");
  grad.addColorStop(0.5, "#122838");
  grad.addColorStop(1, "#0a1520");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2048, 128);
  ctx.fillStyle = "#e8f0f4";
  ctx.font = "bold 52px 'Barlow Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const slot = 2048 / labels.length;
  labels.forEach((label, i) => {
    ctx.fillStyle = i % 2 === 0 ? "#d4b06a" : "#e8f0f4";
    ctx.fillText(label, slot * (i + 0.5), 64);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function Goal({ x }: { x: number }) {
  const netTex = useMemo(() => (typeof document !== "undefined" ? createNetTexture() : null), []);
  const side = x > 0 ? 1 : -1;
  const gw = PITCH.goalWidth;
  const gh = PITCH.goalHeight;
  const half = gw / 2;
  const depth = 2.2;
  const post = PITCH.postRadius * 2;

  return (
    <group position={[x, 0, 0]}>
      {/* Posts */}
      <mesh position={[0, gh / 2, -half]} castShadow>
        <boxGeometry args={[post, gh, post]} />
        <meshStandardMaterial color="#e8f0ec" metalness={0.55} roughness={0.25} />
      </mesh>
      <mesh position={[0, gh / 2, half]} castShadow>
        <boxGeometry args={[post, gh, post]} />
        <meshStandardMaterial color="#e8f0ec" metalness={0.55} roughness={0.25} />
      </mesh>
      {/* Crossbar */}
      <mesh position={[0, gh, 0]} castShadow>
        <boxGeometry args={[post, post, gw]} />
        <meshStandardMaterial color="#e8f0ec" metalness={0.55} roughness={0.25} />
      </mesh>
      {/* Back net */}
      <mesh position={[-side * depth, gh / 2, 0]}>
        <planeGeometry args={[depth * 0.3 + 0.4, gh]} />
        <meshStandardMaterial
          map={netTex || undefined}
          color="#dce4ea"
          transparent
          opacity={0.55}
          alphaTest={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Side nets */}
      {([-1, 1] as const).map((s) => (
        <mesh
          key={s}
          position={[-side * (depth / 2), gh / 2, s * half]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[depth, gh]} />
          <meshStandardMaterial
            map={netTex || undefined}
            color="#dce4ea"
            transparent
            opacity={0.45}
            alphaTest={0.1}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* Top net */}
      <mesh
        position={[-side * (depth / 2), gh, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[depth, gw]} />
        <meshStandardMaterial
          map={netTex || undefined}
          color="#dce4ea"
          transparent
          opacity={0.4}
          alphaTest={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function CornerFlag({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 1.5, 8]} />
        <meshStandardMaterial color="#e8e8e8" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0.18, 1.35, 0]} rotation={[0, 0, -0.3]}>
        <planeGeometry args={[0.4, 0.28]} />
        <meshStandardMaterial color="#e02020" side={THREE.DoubleSide} roughness={0.7} />
      </mesh>
    </group>
  );
}

function StandTier({
  axis,
  sign,
  rows = 8,
}: {
  axis: "z" | "x";
  sign: 1 | -1;
  rows?: number;
}) {
  const along = axis === "z" ? PITCH.length + 4 : PITCH.width + 2;
  const base = axis === "z" ? PITCH.halfZ + 1.8 : PITCH.halfX + 1.8;
  // Slight per-row concrete variance so stands aren't flat grey boxes
  const rowMats = useMemo(() => {
    return Array.from({ length: rows }).map((_, i) => {
      const t = i / Math.max(1, rows - 1);
      const r = 0.18 + t * 0.06 + (i % 3) * 0.02;
      const g = 0.22 + t * 0.05 + (i % 2) * 0.015;
      const b = 0.26 + t * 0.04;
      const hex = new THREE.Color(r, g, b).getStyle();
      return {
        color: hex,
        roughness: 0.72 + (i % 4) * 0.05,
        metalness: 0.04 + (i % 3) * 0.02,
      };
    });
  }, [rows]);

  return (
    <group>
      {Array.from({ length: rows }).map((_, i) => {
        const rise = 0.4 + i * 0.58;
        const out = base + i * 0.72;
        const pos: [number, number, number] =
          axis === "z" ? [0, rise, sign * out] : [sign * out, rise, 0];
        const geo: [number, number, number] =
          axis === "z" ? [along, 0.5, 0.7] : [0.7, 0.5, along * 0.92];
        const mat = rowMats[i];
        return (
          <mesh key={i} position={pos} castShadow receiveShadow>
            <boxGeometry args={geo} />
            <meshStandardMaterial
              color={mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
            />
          </mesh>
        );
      })}
      {/* Back wall */}
      <mesh
        position={
          axis === "z"
            ? [0, 3.2, sign * (base + rows * 0.72 + 0.5)]
            : [sign * (base + rows * 0.72 + 0.5), 3.2, 0]
        }
        castShadow
      >
        <boxGeometry
          args={axis === "z" ? [along + 2, 5.2, 0.9] : [0.9, 5.2, along * 0.95]}
        />
        <meshStandardMaterial color="#243038" roughness={0.78} metalness={0.06} />
      </mesh>
    </group>
  );
}

function RoofCanopy({ axis, sign }: { axis: "z" | "x"; sign: 1 | -1 }) {
  const along = axis === "z" ? PITCH.length + 6 : PITCH.width + 4;
  const zOrX = axis === "z" ? sign * (PITCH.halfZ + 8) : sign * (PITCH.halfX + 8);
  const beamPos: [number, number, number] =
    axis === "z" ? [0, 11, zOrX] : [zOrX, 11, 0];
  const beamGeo: [number, number, number] =
    axis === "z" ? [along, 0.4, 0.4] : [0.4, 0.4, along];
  const canopyPos: [number, number, number] =
    axis === "z" ? [0, 10.6, sign * (PITCH.halfZ + 5.5)] : [sign * (PITCH.halfX + 5.5), 10.6, 0];
  const canopyGeo: [number, number, number] =
    axis === "z" ? [along - 2, 0.15, 8] : [8, 0.15, along - 4];
  const posts =
    axis === "z"
      ? ([-40, -20, 0, 20, 40] as const)
      : ([-24, -8, 8, 24] as const);

  return (
    <group>
      <mesh position={beamPos} castShadow>
        <boxGeometry args={beamGeo} />
        <meshStandardMaterial color="#3a444c" metalness={0.55} roughness={0.4} />
      </mesh>
      {posts.map((p) => (
        <mesh
          key={p}
          position={
            axis === "z"
              ? [p, 6.5, sign * (PITCH.halfZ + 8)]
              : [sign * (PITCH.halfX + 8), 6.5, p]
          }
          castShadow
        >
          <boxGeometry args={[0.25, 9, 0.25]} />
          <meshStandardMaterial color="#3a444c" metalness={0.55} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={canopyPos} castShadow>
        <boxGeometry args={canopyGeo} />
        <meshStandardMaterial color="#2a343c" metalness={0.15} roughness={0.75} />
      </mesh>
    </group>
  );
}

function Hoardings() {
  const tex = useMemo(
    () => (typeof document !== "undefined" ? createHoardingTexture(SPONSORS) : null),
    []
  );
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((_, delta) => {
    if (tex) {
      tex.offset.x = (tex.offset.x + delta * 0.08) % 1;
    }
  });

  const mats = (
    <meshStandardMaterial
      ref={matRef}
      map={tex || undefined}
      color="#1a3040"
      emissive="#d4b06a"
      emissiveIntensity={0.45}
      roughness={0.35}
      metalness={0.25}
    />
  );

  const hx = PITCH.halfX + 0.4;
  const hz = PITCH.halfZ + 0.4;

  return (
    <group>
      <mesh position={[0, 0.7, -hz]} castShadow>
        <boxGeometry args={[PITCH.length - 2, 1.2, 0.18]} />
        {mats}
      </mesh>
      <mesh position={[0, 0.7, hz]} castShadow>
        <boxGeometry args={[PITCH.length - 2, 1.2, 0.18]} />
        {mats}
      </mesh>
      <mesh position={[-hx, 0.7, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[PITCH.width - 2, 1.2, 0.18]} />
        {mats}
      </mesh>
      <mesh position={[hx, 0.7, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[PITCH.width - 2, 1.2, 0.18]} />
        {mats}
      </mesh>
    </group>
  );
}

export function Stadium({ snowAmount = 0 }: { snowAmount?: number }) {
  const hx = PITCH.halfX;
  const hz = PITCH.halfZ;
  const hasStadiumGlb = useModelAvailable("/models/stadium.glb");
  const hasGoalGlb = useModelAvailable("/models/goal.glb");

  return (
    <group>
      <Pitch snowAmount={snowAmount} />
      <StadiumShellModel />
      {hasGoalGlb ? (
        <>
          <GoalModel side={-1} />
          <GoalModel side={1} />
        </>
      ) : (
        <>
          <Goal x={-hx + 0.15} />
          <Goal x={hx - 0.15} />
        </>
      )}
      <CornerFlag x={-hx} z={-hz} />
      <CornerFlag x={-hx} z={hz} />
      <CornerFlag x={hx} z={-hz} />
      <CornerFlag x={hx} z={hz} />
      {/* Keep procedural stands unless a full stadium shell is provided */}
      {!hasStadiumGlb && (
        <>
          <StandTier axis="z" sign={-1} />
          <StandTier axis="z" sign={1} />
          <StandTier axis="x" sign={-1} rows={6} />
          <StandTier axis="x" sign={1} rows={6} />
          <RoofCanopy axis="z" sign={-1} />
          <RoofCanopy axis="z" sign={1} />
          <RoofCanopy axis="x" sign={-1} />
          <RoofCanopy axis="x" sign={1} />
        </>
      )}
      <Hoardings />
    </group>
  );
}
