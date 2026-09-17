"use client";

import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ContactShadows, SoftShadows } from "@react-three/drei";
import * as THREE from "three";

/** Procedural mown-stripe pitch that accumulates snow as the match progresses. */
export function StripedPitch({ snowAmount }: { snowAmount: number }) {
  const mat = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSnow: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uSnow;
        varying vec2 vUv;
        void main() {
          float stripe = step(0.5, fract(vUv.x * 18.0));
          vec3 grassA = vec3(0.08, 0.28, 0.18);
          vec3 grassB = vec3(0.10, 0.32, 0.20);
          vec3 grass = mix(grassA, grassB, stripe);
          vec3 snow = vec3(0.86, 0.90, 0.93);
          vec3 color = mix(grass, snow, clamp(uSnow, 0.0, 0.85));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    return material;
  }, []);

  useFrame((state) => {
    mat.uniforms.uSnow.value = snowAmount;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <planeGeometry args={[42, 28]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

export function SnowStorm({ count = 4000 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 28;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
      speeds[i] = 0.8 + Math.random() * 1.8;
    }
    return { positions, speeds };
  }, [count]);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speeds[i] * delta;
      arr[i * 3] += Math.sin(i + arr[i * 3 + 1]) * 0.01;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 22 + Math.random() * 6;
        arr[i * 3] = (Math.random() - 0.5) * 60;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
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
        color="#e8f0f4"
        size={0.08}
        sizeAttenuation
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </points>
  );
}

export function Floodlights() {
  const corners: [number, number, number][] = [
    [-20, 14, -15],
    [20, 14, -15],
    [-20, 14, 15],
    [20, 14, 15],
  ];
  return (
    <group>
      {corners.map((pos, i) => (
        <group key={i} position={pos}>
          <mesh castShadow>
            <cylinderGeometry args={[0.25, 0.35, 12, 8]} />
            <meshStandardMaterial color="#2a3034" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 6.2, 0]}>
            <boxGeometry args={[1.6, 0.4, 0.8]} />
            <meshStandardMaterial color="#c9d6de" emissive="#a8c0d0" emissiveIntensity={1.2} />
          </mesh>
          <spotLight
            position={[0, 6.4, 0]}
            angle={0.55}
            penumbra={0.45}
            intensity={80}
            distance={60}
            castShadow
            color="#dce8f0"
          />
        </group>
      ))}
    </group>
  );
}

export function Crowd({ count = 3000 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const phases = useMemo(() => Float32Array.from({ length: count }, () => Math.random() * Math.PI * 2), [count]);

  useMemo(() => {
    const mesh = meshRef.current;
    // positions filled in useFrame first tick via layout below
  }, []);

  React.useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    let i = 0;
    const rows = 8;
    const perRow = Math.floor(count / (rows * 2));
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        for (let seat = 0; seat < perRow && i < count; seat++, i++) {
          const x = (seat / perRow - 0.5) * 38;
          const y = 1.2 + row * 0.55;
          const z = side * (14.5 + row * 0.55);
          dummy.position.set(x, y, z);
          dummy.scale.set(0.28, 0.55 + Math.random() * 0.25, 0.28);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const palette = side < 0 ? [0.83, 0.69, 0.42] : [0.75, 0.85, 0.95];
          color.setRGB(
            palette[0] * (0.7 + Math.random() * 0.3),
            palette[1] * (0.7 + Math.random() * 0.3),
            palette[2] * (0.7 + Math.random() * 0.3)
          );
          mesh.setColorAt(i, color);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, color, dummy]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      mesh.getMatrixAt(i, dummy.matrix);
      dummy.position.setFromMatrixPosition(dummy.matrix);
      const baseY = dummy.position.y;
      // Extract scale from matrix roughly — wave on Y only
      dummy.position.y = baseY + Math.sin(t * 2.2 + phases[i]) * 0.08;
      dummy.updateMatrix();
      // Preserve scale: re-read is lossy; simpler bounce via matrix translation hack
    }
    // Cheaper: rotate whole crowd group slightly instead of per-instance rewrite every frame.
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial toneMapped={false} />
    </instancedMesh>
  );
}

export function GroundAtmosphere() {
  return (
    <>
      <SoftShadows size={18} samples={12} focus={0.7} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={50} blur={2.5} far={20} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#070b0a" />
      </mesh>
    </>
  );
}
