"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { PITCH } from "@/lib/pitch";

function createSoftParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(230,240,250,0.55)");
  g.addColorStop(1, "rgba(200,220,240,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createSpectatorTexture(): THREE.CanvasTexture {
  // Atlas of thicker silhouettes — denser read at broadcast distance
  const cols = 4;
  const w = 48;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w * cols;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const bodies = ["#1a2230", "#243044", "#2c3848", "#1e2838"];
  const heads = ["#c4a882", "#b89870", "#d0b090", "#a88868"];
  for (let i = 0; i < cols; i++) {
    const ox = i * w;
    ctx.fillStyle = bodies[i];
    // Broader torso + legs for thicker silhouette
    ctx.fillRect(ox + 12, 22, 24, 36);
    ctx.fillRect(ox + 14, 52, 8, 12);
    ctx.fillRect(ox + 26, 52, 8, 12);
    // Shoulders
    ctx.fillRect(ox + 8, 24, 8, 14);
    ctx.fillRect(ox + 32, 24, 8, 14);
    ctx.beginPath();
    ctx.arc(ox + 24, 14, 9, 0, Math.PI * 2);
    ctx.fillStyle = heads[i];
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function Floodlights({
  withShafts = true,
  shadowMapSize = 1024,
}: {
  withShafts?: boolean;
  shadowMapSize?: number;
}) {
  const mapSize = Math.min(2048, Math.max(512, shadowMapSize));
  // World-space aim points on pitch thirds (must NOT be local to the pole group)
  const aims: [number, number, number][] = [
    [-18, 0.1, -12],
    [18, 0.1, -12],
    [-18, 0.1, 12],
    [18, 0.1, 12],
  ];
  const corners: [number, number, number][] = [
    [-PITCH.halfX - 4, 18, -PITCH.halfZ - 4],
    [PITCH.halfX + 4, 18, -PITCH.halfZ - 4],
    [-PITCH.halfX - 4, 18, PITCH.halfZ + 4],
    [PITCH.halfX + 4, 18, PITCH.halfZ + 4],
  ];
  return (
    <group>
      {corners.map((pos, i) => (
        <FloodRig
          key={i}
          pos={pos}
          aim={aims[i]}
          mapSize={mapSize}
          withShafts={withShafts}
        />
      ))}
    </group>
  );
}

function FloodRig({
  pos,
  aim,
  mapSize,
  withShafts,
}: {
  pos: [number, number, number];
  aim: [number, number, number];
  mapSize: number;
  withShafts: boolean;
}) {
  const lightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    const light = lightRef.current;
    const target = targetRef.current;
    if (!light || !target) return;
    light.target = target;
    light.target.updateMatrixWorld();
  }, []);

  return (
    <group>
      <object3D ref={targetRef} position={aim} />
      <group position={pos}>
        <mesh castShadow>
          <cylinderGeometry args={[0.35, 0.45, 16, 8]} />
          <meshStandardMaterial color="#2a3034" metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[0, 8.5, 0]}>
          <boxGeometry args={[2.4, 0.55, 1.2]} />
          <meshStandardMaterial
            color="#c9d6de"
            emissive="#a8c0d0"
            emissiveIntensity={3.2}
            metalness={0.4}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0, 8.7, 0]}>
          <sphereGeometry args={[0.7, 12, 12]} />
          <meshBasicMaterial color="#e8f4ff" transparent opacity={0.45} depthWrite={false} />
        </mesh>
        <spotLight
          ref={lightRef}
          position={[0, 8.7, 0]}
          angle={0.62}
          penumbra={0.45}
          intensity={280}
          distance={140}
          castShadow
          color="#eef4fa"
          shadow-bias={-0.00035}
          shadow-mapSize-width={mapSize}
          shadow-mapSize-height={mapSize}
        />
        {withShafts && (
          <mesh position={[0, 3, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[9, 15, 24, 1, true]} />
            <meshBasicMaterial
              color="#c8daf0"
              transparent
              opacity={0.055}
              depthWrite={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

function SnowLayer({
  count,
  speedScale,
  size,
}: {
  count: number;
  speedScale: number;
  size: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const tex = useMemo(() => createSoftParticleTexture(), []);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 140;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
      speeds[i] = (0.6 + Math.random() * 1.6) * speedScale;
    }
    return { positions, speeds };
  }, [count, speedScale]);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speeds[i] * delta;
      arr[i * 3] += Math.sin(i * 0.1 + arr[i * 3 + 1]) * 0.012 * speedScale;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 28 + Math.random() * 10;
        arr[i * 3] = (Math.random() - 0.5) * 140;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 100;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={tex}
        color="#e8f0f4"
        size={size}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function SnowStorm({
  near = 2200,
  far = 1800,
}: {
  near?: number;
  far?: number;
}) {
  return (
    <group>
      <SnowLayer count={near} speedScale={1.35} size={0.14} />
      <SnowLayer count={far} speedScale={0.55} size={0.22} />
    </group>
  );
}

export function GroundMist() {
  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = (Math.sin(x * 0.08) + Math.cos(y * 0.07) + Math.sin((x + y) * 0.04)) * 0.25 + 0.5;
        const v = Math.floor(n * 255);
        ctx.fillStyle = `rgba(${v},${v},${v},1)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 4);
    return t;
  }, []);

  useFrame((_, delta) => {
    if (tex) {
      tex.offset.x += delta * 0.015;
      tex.offset.y += delta * 0.008;
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
      <planeGeometry args={[PITCH.length + 20, PITCH.width + 16]} />
      <meshBasicMaterial
        map={tex}
        color="#b8c8d4"
        transparent
        opacity={0.06}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/** GPU-waved instanced crowd billboards on all four stands. */
export function Crowd({ count = 2000 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const spectatorTex = useMemo(() => createSpectatorTexture(), []);
  const phases = useMemo(() => {
    const a = new Float32Array(count);
    for (let i = 0; i < count; i++) a[i] = Math.random() * Math.PI * 2;
    return a;
  }, [count]);
  const atlasOffsets = useMemo(() => {
    const a = new Float32Array(count);
    for (let i = 0; i < count; i++) a[i] = Math.floor(Math.random() * 4) / 4;
    return a;
  }, [count]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    let i = 0;
    const rows = 10;
    const banks = 4;
    const perBank = Math.floor(count / banks);
    const perRow = Math.floor(perBank / rows);

    const placeBank = (
      axis: "z" | "x",
      sign: 1 | -1,
      palette: [number, number, number]
    ) => {
      const span = axis === "z" ? PITCH.length - 4 : PITCH.width - 4;
      const base = axis === "z" ? PITCH.halfZ + 2.2 : PITCH.halfX + 2.2;
      for (let row = 0; row < rows; row++) {
        for (let seat = 0; seat < perRow && i < count; seat++, i++) {
          const jitter = (Math.random() - 0.5) * 0.35;
          const along = (seat / Math.max(1, perRow - 1) - 0.5) * span + jitter;
          const y = 1.45 + row * 0.52;
          const out = base + row * 0.68;
          if (axis === "z") {
            dummy.position.set(along, y, sign * out);
          } else {
            dummy.position.set(sign * out, y, along);
          }
          // Thicker billboards — fewer empty gaps at broadcast distance
          const s = 1.15 + Math.random() * 0.35;
          dummy.scale.set(s * 0.85, s, 1);
          dummy.lookAt(0, y, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          color.setRGB(
            palette[0] * (0.55 + Math.random() * 0.45),
            palette[1] * (0.55 + Math.random() * 0.45),
            palette[2] * (0.55 + Math.random() * 0.45)
          );
          mesh.setColorAt(i, color);
        }
      }
    };

    placeBank("z", -1, [0.83, 0.69, 0.42]);
    placeBank("z", 1, [0.7, 0.82, 0.95]);
    placeBank("x", -1, [0.75, 0.72, 0.55]);
    placeBank("x", 1, [0.65, 0.75, 0.9]);

    while (i < count) {
      dummy.position.set(0, -10, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      i++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const geom = mesh.geometry as THREE.BufferGeometry;
    geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geom.setAttribute("aAtlas", new THREE.InstancedBufferAttribute(atlasOffsets, 1));
  }, [count, color, dummy, phases, atlasOffsets]);

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aPhase;
         attribute float aAtlas;
         varying float vAtlas;
         uniform float uTime;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         transformed.y += sin(uTime * 2.2 + aPhase) * 0.08;
         vAtlas = aAtlas;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vAtlas;`
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
         vec2 atlasUv = vec2(vMapUv.x * 0.25 + vAtlas, vMapUv.y);
         vec4 sampledDiffuseColor = texture2D(map, atlasUv);
         diffuseColor *= sampledDiffuseColor;
         #endif`
      );
    (meshRef.current as any).__crowdShader = shader;
  };

  useFrame((state) => {
    const shader = (meshRef.current as any)?.__crowdShader;
    if (shader?.uniforms?.uTime) {
      shader.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow frustumCulled={false}>
      <planeGeometry args={[0.55, 0.95]} />
      <meshStandardMaterial
        map={spectatorTex}
        transparent
        alphaTest={0.15}
        roughness={0.85}
        onBeforeCompile={onBeforeCompile}
      />
    </instancedMesh>
  );
}

export function GroundAtmosphere() {
  return (
    <>
      <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={130} blur={3.2} far={40} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[220, 180]} />
        <meshStandardMaterial color="#0a1014" roughness={1} />
      </mesh>
      <GroundMist />
    </>
  );
}
