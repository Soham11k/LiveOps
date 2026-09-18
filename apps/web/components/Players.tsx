"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getKitMap, getNumberMap, kitHex, kitSkinHex, type KitRole } from "@/lib/kitTexture";
import { PITCH } from "@/lib/pitch";

export type PlayerAnim = "idle" | "run" | "kick" | "pass";

type Phase = "ready" | "run" | "chance" | "done" | "replay";

const availabilityCache = new Map<string, Promise<boolean>>();

function checkModel(path: string): Promise<boolean> {
  const cached = availabilityCache.get(path);
  if (cached) return cached;
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
  kitRole = "home",
}: {
  color: string;
  phase?: Phase;
  kicking?: boolean;
  anim?: PlayerAnim;
  number?: number;
  kitRole?: KitRole;
}) {
  const group = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const numMap = useMemo(() => (number != null ? getNumberMap(number) : null), [number]);
  const kitMap = useMemo(
    () => (number != null ? getKitMap(kitRole, number) : getKitMap(kitRole, 9)),
    [kitRole, number]
  );
  const skin = kitSkinHex(kitRole);

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

  // Jointed LOD can use flat kit canvas UVs (simple capsules) — GLB keeps tint-only
  const kitMat = (
    <meshStandardMaterial
      color="#ffffff"
      map={kitMap || undefined}
      roughness={0.48}
      metalness={0.05}
      emissive={color}
      emissiveIntensity={0.14}
    />
  );
  const shortsMat = (
    <meshStandardMaterial color="#1a1e24" roughness={0.7} metalness={0.02} emissive="#1a1e24" emissiveIntensity={0.06} />
  );
  const skinMat = <meshStandardMaterial color={skin} roughness={0.65} metalness={0.02} />;

  return (
    <group ref={group}>
      <group ref={torso} position={[0, 0.95, 0]}>
        <mesh castShadow position={[0, 0.15, 0]}>
          <capsuleGeometry args={[0.22, 0.45, 6, 10]} />
          {kitMat}
        </mesh>
        <mesh castShadow position={[0, 0.62, 0]}>
          <sphereGeometry args={[0.18, 14, 14]} />
          {skinMat}
        </mesh>
        {number != null && (
          <mesh position={[0, 0.2, -0.24]}>
            <planeGeometry args={[0.3, 0.34]} />
            <meshStandardMaterial
              map={numMap || undefined}
              color={numMap ? "#ffffff" : "#f8faf8"}
              transparent={!!numMap}
              emissive="#f8faf8"
              emissiveIntensity={0.35}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        )}
        <group ref={leftArm} position={[-0.32, 0.25, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
            {kitMat}
          </mesh>
        </group>
        <group ref={rightArm} position={[0.32, 0.25, 0]}>
          <mesh castShadow position={[0, -0.28, 0]}>
            <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
            {kitMat}
          </mesh>
        </group>
      </group>
      <group ref={leftLeg} position={[-0.12, 0.55, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
          {shortsMat}
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.12, 0.55, 0]}>
        <mesh castShadow position={[0, -0.32, 0]}>
          <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
          {shortsMat}
        </mesh>
      </group>
    </group>
  );
}

function applyKit(
  root: THREE.Object3D,
  color: string,
  kitRole: KitRole,
  _number: number
) {
  const team = new THREE.Color(color);
  const skin = new THREE.Color(kitSkinHex(kitRole));
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
    const isSkin =
      n.includes("head") ||
      n.includes("face") ||
      n.includes("skin") ||
      n.includes("neck") ||
      n.includes("hand") ||
      n.includes("eyel") ||
      n.includes("mouth");
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) => {
      const src = m as THREE.MeshStandardMaterial;
      const cloned =
        src && "color" in src
          ? src.clone()
          : new THREE.MeshStandardMaterial({ color: team });
      if (isSkin) {
        if (cloned.color) cloned.color.copy(skin);
        cloned.map = null;
        cloned.roughness = 0.72;
        cloned.metalness = 0.02;
        if (cloned.emissive) cloned.emissive.set("#000000");
      } else {
        // Mixamo UVs ≠ flat kit canvas — tint original albedo instead of replacing map
        if (cloned.color) cloned.color.copy(team).multiplyScalar(1.25);
        if (cloned.emissive) cloned.emissive.copy(team).multiplyScalar(0.22);
        cloned.roughness = 0.45;
        cloned.metalness = 0.04;
      }
      cloned.side = THREE.DoubleSide;
      cloned.transparent = false;
      cloned.opacity = 1;
      cloned.depthWrite = true;
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
    // SkinnedMesh AABB is unreliable before first skeleton update — prefer geometry bounds
    let height = 0;
    c.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!(mesh as THREE.Mesh).isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry;
      if (!geom) return;
      geom.computeBoundingBox();
      const gbox = geom.boundingBox;
      if (!gbox) return;
      const h = gbox.max.y - gbox.min.y;
      if (h > height) height = h;
    });
    if (height < 0.3) {
      const box = new THREE.Box3().setFromObject(c);
      height = Math.max(0.3, box.max.y - box.min.y);
    }
    // Mixamo packs sometimes ship in centimetres (~170–180)
    if (height > 50) height *= 0.01;
    const s = PITCH.playerHeight / height;
    c.scale.setScalar(s);
    const boxAfter = new THREE.Box3().setFromObject(c);
    c.position.set(0, -boxAfter.min.y, 0);
    c.rotation.y = Math.PI;
    c.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if ((mesh as THREE.Mesh).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.visible = true;
      }
      if (mesh.isSkinnedMesh && mesh.skeleton) {
        mesh.skeleton.update();
      }
    });
    const numMap = getNumberMap(number);
    if (numMap) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.4),
        new THREE.MeshStandardMaterial({
          map: numMap,
          transparent: true,
          toneMapped: false,
          depthWrite: false,
          emissive: new THREE.Color("#f8faf8"),
          emissiveIntensity: 0.4,
          roughness: 0.6,
          metalness: 0,
        })
      );
      plate.position.set(0, 1.28, -0.2);
      plate.rotation.y = Math.PI;
      plate.renderOrder = 2;
      c.add(plate);
    }
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
    // Controlled player always keeps Mixamo GLB under broadcast framing
    if (controlled) {
      if (!lodState.current) {
        lodState.current = true;
        setUseGlb(true);
      }
      return;
    }
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
      <Suspense
        fallback={
          <JointedPlayer
            color={tint}
            phase={phase}
            kicking={kicking}
            anim={anim}
            number={number}
            kitRole={role}
          />
        }
      >
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
      <JointedPlayer
        color={tint}
        phase={phase}
        kicking={kicking}
        anim={anim}
        number={number}
        kitRole={role}
      />
    );

  return (
    <group ref={groupRef}>
      {body}
      {showChevron || controlled ? <PlayerChevron color={tint} /> : null}
    </group>
  );
}

useGLTF.preload("/models/player.glb");
