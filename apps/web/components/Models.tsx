"use client";

import React, { Suspense, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { GroupProps } from "@react-three/fiber";
import * as THREE from "three";
import { PITCH } from "@/lib/pitch";
import { useModelAvailable } from "@/lib/modelAvailability";

function PrimitiveBall(props: GroupProps) {
  const r = PITCH.ballRadius;
  return (
    <group {...props}>
      <mesh castShadow>
        <sphereGeometry args={[r, 24, 24]} />
        <meshStandardMaterial
          color="#f4f7f2"
          roughness={0.35}
          metalness={0.12}
          envMapIntensity={1.2}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[r * 0.92, 0.008, 8, 24]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>
    </group>
  );
}

function GlbBall(props: GroupProps) {
  const gltf = useGLTF("/models/ball.glb");
  const root = useMemo(() => {
    const c = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const diam = Math.max(size.x, size.y, size.z, 0.001);
    const s = (PITCH.ballRadius * 2) / diam;
    c.scale.setScalar(s);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [gltf.scene]);
  return <primitive object={root} {...props} />;
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

export { Stadium as StadiumModel } from "@/components/Stadium";
export { AnimatedPlayer as PlayerModel } from "@/components/Players";

useGLTF.preload("/models/ball.glb");
