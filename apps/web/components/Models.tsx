"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useGLTF } from "@react-three/drei";
import type { GroupProps } from "@react-three/fiber";
import * as THREE from "three";

const availabilityCache = new Map<string, Promise<boolean>>();

function checkModel(path: string): Promise<boolean> {
  const cached = availabilityCache.get(path);
  if (cached) return cached;
  const promise = fetch(path, { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  availabilityCache.set(path, promise);
  return promise;
}

function useModelAvailable(path: string) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    checkModel(path).then((available) => {
      if (!cancelled) setOk(available);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return ok;
}

function PrimitiveBall(props: GroupProps) {
  return (
    <mesh {...props} castShadow>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshStandardMaterial color="#f4f7f2" roughness={0.35} />
    </mesh>
  );
}

function GlbBall(props: GroupProps) {
  const gltf = useGLTF("/models/ball.glb");
  return <primitive object={gltf.scene.clone()} {...props} scale={0.45} />;
}

export function BallModel(props: GroupProps) {
  const available = useModelAvailable("/models/ball.glb");
  if (!available) return <PrimitiveBall {...props} />;
  return (
    <Suspense fallback={<PrimitiveBall {...props} />}>
      <GlbBall {...props} />
    </Suspense>
  );
}

function PrimitivePlayer({ color, ...props }: GroupProps & { color: string }) {
  return (
    <group {...props}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.7, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
}

function GlbPlayer({ color, ...props }: GroupProps & { color: string }) {
  const gltf = useGLTF("/models/player.glb");
  return (
    <group {...props}>
      <primitive object={gltf.scene.clone()} scale={0.9} />
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.05, 16]} />
        <meshStandardMaterial color={color} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

export function PlayerModel({ color, ...props }: GroupProps & { color: string }) {
  const available = useModelAvailable("/models/player.glb");
  if (!available) return <PrimitivePlayer color={color} {...props} />;
  return (
    <Suspense fallback={<PrimitivePlayer color={color} {...props} />}>
      <GlbPlayer color={color} {...props} />
    </Suspense>
  );
}

function Goal({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 1.2, -2.2]}>
        <boxGeometry args={[0.15, 2.4, 0.15]} />
        <meshStandardMaterial color="#d9efe8" />
      </mesh>
      <mesh position={[0, 1.2, 2.2]}>
        <boxGeometry args={[0.15, 2.4, 0.15]} />
        <meshStandardMaterial color="#d9efe8" />
      </mesh>
      <mesh position={[0, 2.4, 0]}>
        <boxGeometry args={[0.15, 0.15, 4.4]} />
        <meshStandardMaterial color="#d9efe8" />
      </mesh>
    </group>
  );
}

function PrimitiveStadium() {
  const border = React.useMemo(() => new THREE.BoxGeometry(36, 0.02, 22), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[42, 28]} />
        <meshStandardMaterial color="#14352c" />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[border]} />
        <lineBasicMaterial color="#e8f4e4" />
      </lineSegments>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.8, 4.0, 48]} />
        <meshStandardMaterial color="#e8f4e4" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.08, 22]} />
        <meshStandardMaterial color="#e8f4e4" />
      </mesh>
      <Goal x={-18} />
      <Goal x={18} />
      <mesh position={[0, 1.2, -14]} castShadow>
        <boxGeometry args={[40, 2.4, 2]} />
        <meshStandardMaterial color="#1a2420" />
      </mesh>
      <mesh position={[0, 1.2, 14]} castShadow>
        <boxGeometry args={[40, 2.4, 2]} />
        <meshStandardMaterial color="#1a2420" />
      </mesh>
    </group>
  );
}

function GlbStadium() {
  const gltf = useGLTF("/models/stadium.glb");
  return <primitive object={gltf.scene.clone()} scale={1} />;
}

export function StadiumModel() {
  const available = useModelAvailable("/models/stadium.glb");
  if (!available) return <PrimitiveStadium />;
  return (
    <Suspense fallback={<PrimitiveStadium />}>
      <GlbStadium />
    </Suspense>
  );
}
