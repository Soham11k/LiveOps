"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getKitMap, kitHex, type KitRole } from "@/lib/kitTexture";
import { PITCH } from "@/lib/pitch";

export type PlayerAnim = "idle" | "run" | "kick" | "pass";

type Phase = "ready" | "run" | "chance" | "done" | "replay";

const availabilityCache = new Map<string, Promise<boolean>>();

function checkModel(path: string): Promise<boolean> {
  const cached = availabilityCache.get(path);
  if (cached) return cached;
  // GET (not HEAD): some static hosts/dev servers mishandle HEAD for binary assets
  const promise = fetch(path, { method: "GET", headers: { Range: "bytes=0-0" } })
    .then((r) => r.ok || r.status === 206)
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

/** Jointed procedural player — fallback when GLB missing or far LOD. */
export function JointedPlayer({
  color,
  phase = "run",
  kicking = false,
  anim = "run",
  number,
}: {
  color: string;
  phase?: Phase;
  kicking?: boolean;
  anim?: PlayerAnim;
  number?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const isKick = kicking || anim === "kick" || anim === "pass";
    const running =
      !isKick && (anim === "run" || phase === "run" || phase === "chance" || phase === "replay");
    const speed = isKick ? 0.4 : running ? 8 : 1.2;
    const amp = isKick ? 0.15 : running ? 0.7 : 0.12;
    const swing = Math.sin(t * speed) * amp;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftArm.current) leftArm.current.rotation.x = -swing * 0.85;
    if (rightArm.current) {
      rightArm.current.rotation.x = isKick ? -1.4 : swing * 0.85;
      rightArm.current.rotation.z = isKick ? 0.4 : 0.15;
    }
    if (torso.current) {
      torso.current.rotation.x = running ? -0.12 : 0;
      torso.current.rotation.z = Math.sin(t * speed * 0.5) * 0.04;
    }
    if (group.current) {
      group.current.position.y = running ? Math.abs(Math.sin(t * speed)) * 0.06 : 0;
    }
  });

  const mat = <meshStandardMaterial color={color} roughness={0.55} metalness={0.08} />;

  return (
    <group ref={group}>
      <group ref={torso} position={[0, 0.95, 0]}>
        <mesh castShadow position={[0, 0.15, 0]}>
          <capsuleGeometry args={[0.22, 0.45, 6, 10]} />
          {mat}
        </mesh>
        <mesh castShadow position={[0, 0.62, 0]}>
          <sphereGeometry args={[0.18, 14, 14]} />
          {mat}
        </mesh>
        {number != null && (
          <mesh position={[0, 0.2, -0.24]}>
            <planeGeometry args={[0.28, 0.32]} />
            <meshBasicMaterial color="#f8faf8" toneMapped={false} />
          </mesh>
        )}
        <group ref={leftArm} position={[-0.32, 0.25, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
            {mat}
          </mesh>
        </group>
        <group ref={rightArm} position={[0.32, 0.25, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
            {mat}
          </mesh>
        </group>
      </group>
      <group ref={leftLeg} position={[-0.12, 0.55, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
          {mat}
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.12, 0.55, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
          {mat}
        </mesh>
      </group>
    </group>
  );
}

function applyKit(
  root: THREE.Object3D,
  color: string,
  kitRole: KitRole,
  number: number
) {
  const team = new THREE.Color(color);
  const kitMap = getKitMap(kitRole, number);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const n = (mesh.name || "").toLowerCase();
    if (n.includes("ico") || (n.includes("ball") && !n.includes("beta"))) {
      mesh.visible = false;
      return;
    }
    if (n.includes("joints")) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) => {
      const cloned = (m as THREE.MeshStandardMaterial).clone();
      if ("color" in cloned && cloned.color) {
        cloned.color.copy(team);
      }
      if (kitMap && "map" in cloned) {
        // Tint via color; kit map as detail when UVs exist
        cloned.map = kitMap;
        cloned.color.set("#ffffff");
      }
      if ("emissive" in cloned && cloned.emissive) {
        cloned.emissive.copy(team).multiplyScalar(0.04);
      }
      cloned.roughness = 0.55;
      cloned.metalness = 0.05;
      cloned.side = THREE.DoubleSide;
      cloned.needsUpdate = true;
      return cloned;
    });
  });
}

function pickClip(
  actions: Record<string, THREE.AnimationAction | null>,
  names: string[]
): THREE.AnimationAction | null {
  const keys = Object.keys(actions);
  for (const name of names) {
    const needle = name.toLowerCase();
    const exact = keys.find((k) => k.toLowerCase() === needle);
    if (exact && actions[exact]) return actions[exact];
    const starts = keys.find((k) => k.toLowerCase().startsWith(needle));
    if (starts && actions[starts]) return actions[starts];
    const includes = keys.find((k) => k.toLowerCase().includes(needle));
    if (includes && actions[includes]) return actions[includes];
  }
  const first = Object.values(actions).find(Boolean);
  return first || null;
}

function GlbPlayer({
  color,
  phase = "run",
  kicking = false,
  anim = "run",
  kitRole = "home",
  number = 9,
  animOffset = 0,
}: {
  color: string;
  phase?: Phase;
  kicking?: boolean;
  anim?: PlayerAnim;
  kitRole?: KitRole;
  number?: number;
  animOffset?: number;
}) {
  const gltf = useGLTF("/models/player.glb");
  const clone = useMemo(() => {
    const c = skeletonClone(gltf.scene);
    applyKit(c, color, kitRole, number);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const height = Math.max(0.001, box.max.y - box.min.y);
    const s = PITCH.playerHeight / height;
    c.scale.setScalar(s);
    c.position.set(0, -box.min.y * s, 0);
    c.rotation.y = Math.PI;
    c.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if ((mesh as THREE.Mesh).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
      if (mesh.isSkinnedMesh && mesh.skeleton) {
        mesh.skeleton.update();
      }
    });
    return c;
  }, [gltf.scene, color, kitRole, number]);

  const { actions, mixer } = useAnimations(gltf.animations, clone);
  const current = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    if (!actions || Object.keys(actions).length === 0) return;
    let next: THREE.AnimationAction | null = null;
    let once = false;
    const mode: PlayerAnim =
      kicking || anim === "kick" ? "kick" : anim === "pass" ? "pass" : anim === "idle" ? "idle" : "run";

    if (mode === "kick") {
      next = pickClip(actions, ["kick", "penaltykick", "soccerkick", "header"]);
      once = true;
    } else if (mode === "pass") {
      next = pickClip(actions, ["pass", "soccerpass", "kick"]);
      once = true;
    } else if (mode === "idle" || phase === "ready" || phase === "done") {
      next = pickClip(actions, ["idle", "goalieidle", "stand", "pass"]);
    } else {
      next = pickClip(actions, ["running", "run", "jogging", "jog", "walk", "tackle"]);
    }
    if (!next) return;
    if (current.current === next && !once) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.time = animOffset % (next.getClip().duration || 1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.12).play();
    current.current?.fadeOut(0.12);
    current.current = next;
  }, [actions, phase, kicking, anim, animOffset]);

  useFrame((_, delta) => {
    mixer?.update(delta);
  });

  return <primitive object={clone} />;
}

/** Triangle marker above the controlled player. */
export function PlayerChevron({ color = "#f4e4b0" }: { color?: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.position.y = 2.15 + Math.sin(state.clock.elapsedTime * 4) * 0.06;
      ref.current.rotation.y = state.clock.elapsedTime * 1.5;
    }
  });
  return (
    <mesh ref={ref} position={[0, 2.15, 0]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[0.18, 0.28, 3]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

export function AnimatedPlayer({
  color,
  phase = "run",
  kicking = false,
  anim = "run",
  controlled = false,
  lodNear = 40,
  lodFar = 70,
  kitRole,
  number = 9,
  animOffset = 0,
  showChevron = false,
}: {
  color?: string;
  phase?: Phase;
  kicking?: boolean;
  anim?: PlayerAnim;
  controlled?: boolean;
  lodNear?: number;
  lodFar?: number;
  kitRole?: KitRole;
  number?: number;
  animOffset?: number;
  showChevron?: boolean;
}) {
  const available = useModelAvailable("/models/player.glb");
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const [useGlb, setUseGlb] = useState(true);
  const role: KitRole = kitRole ?? (number === 1 ? "gk" : "home");
  const tint = color || kitHex(role);
  const lodState = useRef(true);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const dist = camera.position.distanceTo(g.getWorldPosition(new THREE.Vector3()));
    let next = lodState.current;
    if (dist < lodNear) next = true;
    else if (dist > lodFar) next = false;
    if (next !== lodState.current) {
      lodState.current = next;
      setUseGlb(next);
    }
  });

  const body =
    available && useGlb ? (
      <Suspense fallback={<JointedPlayer color={tint} phase={phase} kicking={kicking} anim={anim} number={number} />}>
        <GlbPlayer
          color={tint}
          phase={phase}
          kicking={kicking}
          anim={anim}
          kitRole={role}
          number={number}
          animOffset={animOffset}
        />
      </Suspense>
    ) : (
      <JointedPlayer color={tint} phase={phase} kicking={kicking} anim={anim} number={number} />
    );

  return (
    <group ref={groupRef}>
      {body}
      {showChevron || controlled ? <PlayerChevron color={tint} /> : null}
    </group>
  );
}

useGLTF.preload("/models/player.glb");
