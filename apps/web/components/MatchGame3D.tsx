"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdaptiveDpr,
  Environment,
  PerformanceMonitor,
  Trail,
} from "@react-three/drei";
import { DepthOfField } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api, type Opponent, type Profile } from "@/lib/api";
import { BallModel } from "@/components/Models";
import { Stadium } from "@/components/Stadium";
import { AnimatedPlayer, type PlayerAnim } from "@/components/Players";
import { Crowd, Floodlights, GroundAtmosphere, SnowStorm } from "@/components/StadiumFX";
import { MatchPost } from "@/components/MatchPost";
import { MatchHUD } from "@/components/MatchHUD";
import { getQuality, stepDown, stepUp, type QualitySettings, type QualityTier } from "@/lib/quality";
import {
  PITCH,
  HOME_SPOTS,
  AWAY_SPOTS,
  CONTROLLED_IDX,
  HOME_NUMBERS,
  AWAY_NUMBERS,
  clampPitchXZ,
} from "@/lib/pitch";
import {
  kickVelocity,
  tryFirstTouch,
  bounceOffPlayer,
  separatePlayers,
  bounceOffPosts,
  POSSESS_RADIUS,
  SPRINT_MAX,
  WALK_MAX,
  PLAYER_ACCEL,
  STAMINA_DRAIN,
  STAMINA_REGEN,
} from "@/lib/pitchPhysics";

type ChanceLog = {
  minute: number;
  timing: number;
  scored: boolean;
  trailing_before: boolean;
  late: boolean;
  attacking_home: boolean;
};

type TickSample = {
  tick_ms: number;
  minute: number;
  ball_x: number;
  ball_y: number;
  ball_z: number;
  possession: "home" | "away";
  home_goals: number;
  away_goals: number;
  phase: string;
  momentum_on: boolean;
  chrome_assist: boolean;
  world_scale: number;
};

type Phase = "ready" | "run" | "done" | "replay";

export type InputState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  pass: boolean;
  lob: boolean;
  sprint: boolean;
  switchPlayer: boolean;
  shootHeld: number;
  /** NDC mouse (−1…1) for optional pitch-plane aim while charging. */
  aimX: number;
  aimY: number;
  aimActive: boolean;
};

export type SceneState = {
  phase: Phase;
  minute: number;
  home: number;
  away: number;
  ball: THREE.Vector3;
  ballVel: THREE.Vector3;
  player: THREE.Vector3;
  playerYaw: number;
  playerSpeed: number;
  possessed: boolean;
  possession: "home" | "away" | "loose";
  anim: PlayerAnim;
  actionUntil: number;
  pauseSec?: number;
  lastGoalAt?: number;
  camMode: "broadcast" | "goal" | "replay";
  riggedPulse: boolean;
  fovPunch?: number;
  matchId?: string;
  controlledIdx: number;
  stamina: number;
  passTargetIdx: number;
  goalEvent?: { side: "home" | "away"; at: number } | null;
  shotLogPending?: ChanceLog | null;
  homePositions?: THREE.Vector3[];
  awayPositions?: THREE.Vector3[];
};

/** ~90′ in ~3.5 real minutes */
const GAME_MINUTES_PER_SEC = 90 / 210;
const TICK_MS = 50;
const SAMPLE_HZ = 10;
const SAMPLE_EVERY_MS = 1000 / SAMPLE_HZ;
const FLUSH_EVERY_MS = 2000;
const BALL_R = PITCH.ballRadius;
const GRAVITY = 18;
const CTRL_HINT =
  "WASD · Shift sprint · Q switch · Space/LMB shoot · E pass · F lob";

function clampPlayer(v: THREE.Vector3) {
  const c = clampPitchXZ(v.x, v.z);
  v.x = c.x;
  v.z = c.z;
  v.y = 0;
}

function BroadcastCamera({
  stateRef,
}: {
  stateRef: React.MutableRefObject<SceneState>;
}) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3(0, 20, 56));
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const camX = useRef(0);
  const camY = useRef(20);
  const camZ = useRef(56);
  const baseFov = useRef(40);

  useFrame((state, delta) => {
    const s = stateRef.current;
    const t = state.clock.elapsedTime;
    const persp = camera as THREE.PerspectiveCamera;

    if (s.camMode === "replay") {
      const rt = (t - (s.lastGoalAt || 0)) * 0.55;
      desired.current.set(
        s.ball.x + Math.sin(rt) * 16,
        7,
        s.ball.z + Math.cos(rt) * 16
      );
      look.current.copy(s.ball);
      baseFov.current = 42;
    } else if (s.camMode === "goal") {
      desired.current.set(s.ball.x * 0.35, 5.5, s.ball.z + 12);
      look.current.copy(s.ball);
      baseFov.current = 38;
    } else {
      // Outside the bowl (stands ~z±42); clear the near tier onto the pitch
      const speed = s.ballVel.length();
      const lead = THREE.MathUtils.clamp(s.ballVel.x * 0.4, -10, 10);
      const targetX = THREE.MathUtils.clamp(s.ball.x + lead, -28, 28);
      camX.current = THREE.MathUtils.damp(camX.current, targetX, 2.4, delta);
      const attack = THREE.MathUtils.clamp(s.ball.x / PITCH.halfX, -1, 1);
      const wantY = 18 + Math.min(4, speed * 0.12) + Math.abs(attack) * 2.5;
      const wantZ = 54 + Math.min(8, speed * 0.25) - Math.abs(attack) * 2;
      camY.current = THREE.MathUtils.damp(camY.current, wantY, 1.6, delta);
      camZ.current = THREE.MathUtils.damp(camZ.current, wantZ, 1.6, delta);
      desired.current.set(camX.current, camY.current, camZ.current);
      look.current.set(
        camX.current * 0.2 + s.ball.x * 0.8,
        1.0 + Math.abs(s.ball.y) * 0.15,
        s.ball.z * 0.55
      );
      baseFov.current = THREE.MathUtils.clamp(40 + speed * 0.12, 40, 44);
    }

    camera.position.lerp(desired.current, 1 - Math.exp(-3.0 * delta));
    camera.lookAt(look.current);

    if (s.fovPunch && s.fovPunch > 0) {
      persp.fov = baseFov.current + s.fovPunch;
      s.fovPunch = Math.max(0, s.fovPunch - delta * 14);
      persp.updateProjectionMatrix();
    } else if (Math.abs(persp.fov - baseFov.current) > 0.05) {
      persp.fov = THREE.MathUtils.lerp(persp.fov, baseFov.current, 1 - Math.exp(-4 * delta));
      persp.updateProjectionMatrix();
    }
  });

  return null;
}

function FocusDoF({ stateRef }: { stateRef: React.MutableRefObject<SceneState> }) {
  const { camera } = useThree();
  const [focus, setFocus] = useState(0.02);
  const activeRef = useRef(false);
  const [, bump] = useState(0);

  useFrame(() => {
    const mode = stateRef.current.camMode;
    const on = mode === "replay" || mode === "goal";
    if (on !== activeRef.current) {
      activeRef.current = on;
      bump((n) => n + 1);
    }
    if (!on) return;
    const dist = camera.position.distanceTo(stateRef.current.ball);
    const next = THREE.MathUtils.clamp(0.008 + dist * 0.0008, 0.008, 0.06);
    setFocus(next);
  });

  if (!activeRef.current) return null;
  return <DepthOfField focusDistance={focus} focalLength={0.022} bokehScale={1.6} height={480} />;
}

function MatchScene({
  stateRef,
  inputRef,
  momentum,
  quality,
  onGoal,
  onShotMiss,
  onControlChange,
}: {
  stateRef: React.MutableRefObject<SceneState>;
  inputRef: React.MutableRefObject<InputState>;
  momentum: boolean;
  quality: QualitySettings;
  onGoal: (side: "home" | "away", log: ChanceLog) => void;
  onShotMiss: (log: ChanceLog) => void;
  onControlChange?: (idx: number) => void;
}) {
  const onGoalRef = useRef(onGoal);
  const onMissRef = useRef(onShotMiss);
  const onCtrlRef = useRef(onControlChange);
  onGoalRef.current = onGoal;
  onMissRef.current = onShotMiss;
  onCtrlRef.current = onControlChange;
  const ballRef = useRef<THREE.Group>(null);
  const homeRefs = useRef<(THREE.Group | null)[]>([]);
  const awayRefs = useRef<(THREE.Group | null)[]>([]);
  const homePos = useRef(HOME_SPOTS.map((s) => new THREE.Vector3(...s)));
  const awayPos = useRef(AWAY_SPOTS.map((s) => new THREE.Vector3(...s)));
  const dirLight = useRef<THREE.DirectionalLight>(null);
  const [snow, setSnow] = useState(0);
  const [vignette, setVignette] = useState(0.18);
  const [hdriOk, setHdriOk] = useState(false);
  const [animPhase, setAnimPhase] = useState<Phase>(stateRef.current.phase);
  const [playerAnim, setPlayerAnim] = useState<PlayerAnim>("idle");
  const [ctrlIdx, setCtrlIdx] = useState(stateRef.current.controlledIdx);
  const [awayAnims, setAwayAnims] = useState<PlayerAnim[]>(() => AWAY_SPOTS.map(() => "idle"));
  const [homeAnims, setHomeAnims] = useState<PlayerAnim[]>(() => HOME_SPOTS.map(() => "idle"));
  const homeAnimsRef = useRef<PlayerAnim[]>(HOME_SPOTS.map(() => "idle"));
  const awayAnimsRef = useRef<PlayerAnim[]>(AWAY_SPOTS.map(() => "idle"));
  const prevAway = useRef(AWAY_SPOTS.map((s) => new THREE.Vector3(...s)));
  const prevHome = useRef(HOME_SPOTS.map((s) => new THREE.Vector3(...s)));
  const shootLatch = useRef(false);
  const passLatch = useRef(false);
  const lobLatch = useRef(false);
  const switchLatch = useRef(false);
  const awayShotCd = useRef(0);
  const { camera } = useThree();
  const pitchPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const aimHit = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    fetch("/hdri/night.hdr", { method: "HEAD" })
      .then((r) => setHdriOk(r.ok))
      .catch(() => setHdriOk(false));
  }, []);

  useEffect(() => {
    const light = dirLight.current;
    if (!light) return;
    light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // Tighter frustum around the pitch — sharper player/ball shadows
    light.shadow.camera.left = -42;
    light.shadow.camera.right = 42;
    light.shadow.camera.top = 32;
    light.shadow.camera.bottom = -32;
    light.shadow.camera.near = 2;
    light.shadow.camera.far = 120;
    light.shadow.bias = -0.00028;
    light.shadow.normalBias = 0.02;
    light.shadow.camera.updateProjectionMatrix();
  }, [quality.shadowMapSize]);

  const switchTo = (idx: number, s: SceneState) => {
    if (idx < 0 || idx >= homePos.current.length || idx === s.controlledIdx) return;
    homePos.current[s.controlledIdx].copy(s.player);
    s.controlledIdx = idx;
    s.player.copy(homePos.current[idx]);
    s.playerSpeed = 0;
    setCtrlIdx(idx);
    onCtrlRef.current?.(idx);
  };

  useFrame((frameState, delta) => {
    const s = stateRef.current;
    const input = inputRef.current;
    const t = frameState.clock.elapsedTime;
    const now = performance.now() / 1000;
    setSnow(s.minute >= 60 ? Math.min(0.28, (s.minute - 60) / 120) : 0);
    if (s.phase !== animPhase) setAnimPhase(s.phase);
    if (s.controlledIdx !== ctrlIdx) setCtrlIdx(s.controlledIdx);

    const trailing = s.home < s.away;
    const lateAssist = momentum && trailing && s.minute >= 70;
    s.riggedPulse = lateAssist && (s.phase === "run" || s.phase === "replay");
    setVignette(s.riggedPulse ? 0.32 + Math.sin(t * 4) * 0.1 : 0.18);

    s.homePositions = homePos.current;
    s.awayPositions = awayPos.current;

    if (s.phase !== "run") {
      if (ballRef.current) ballRef.current.position.copy(s.ball);
      return;
    }

    const controlled = s.controlledIdx;

    // Switch to nearest home player (Q / Tab)
    if (input.switchPlayer && !switchLatch.current) {
      switchLatch.current = true;
      let best = controlled;
      let bestD = Infinity;
      homePos.current.forEach((p, i) => {
        if (i === controlled) return;
        const d = p.distanceTo(s.ball);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      switchTo(best, s);
    }
    if (!input.switchPlayer) switchLatch.current = false;

    // Camera-relative WASD
    let mx = 0;
    let mz = 0;
    if (input.forward) mz -= 1;
    if (input.back) mz += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    const moving = mx !== 0 || mz !== 0;
    const sprinting = input.sprint && s.stamina > 0.05 && moving;
    const maxSpeed = sprinting ? SPRINT_MAX : WALK_MAX;
    if (sprinting) s.stamina = Math.max(0, s.stamina - STAMINA_DRAIN * delta);
    else s.stamina = Math.min(1, s.stamina + STAMINA_REGEN * delta);

    if (moving) {
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      s.playerSpeed = Math.min(maxSpeed, s.playerSpeed + PLAYER_ACCEL * delta);
      s.player.x += mx * s.playerSpeed * delta;
      s.player.z += mz * s.playerSpeed * delta;
      s.playerYaw = Math.atan2(mx, mz);
    } else {
      s.playerSpeed = Math.max(0, s.playerSpeed - PLAYER_ACCEL * 1.4 * delta);
    }
    clampPlayer(s.player);
    homePos.current[s.controlledIdx].copy(s.player);

    const facing = new THREE.Vector3(Math.sin(s.playerYaw), 0, Math.cos(s.playerYaw));

    // Optional mouse aim onto pitch while charging
    let aimPoint: THREE.Vector3 | null = null;
    if (input.aimActive && (input.shoot || input.lob)) {
      ndc.set(input.aimX, input.aimY);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(pitchPlane, aimHit)) {
        aimPoint = aimHit.clone();
      }
    }

    // Possession + contested first-touch
    const distBall = s.player.distanceTo(s.ball);
    if (s.possessed && s.possession === "home") {
      s.ball.set(
        s.player.x + facing.x * 0.9,
        BALL_R,
        s.player.z + facing.z * 0.9
      );
      s.ballVel.set(0, 0, 0);
    } else if (!s.possessed) {
      const touch = tryFirstTouch(
        s.player.x,
        s.player.z,
        s.ball.x,
        s.ball.y,
        s.ball.z,
        s.ballVel.length()
      );
      if (touch === "claim") {
        s.possessed = true;
        s.possession = "home";
        if (s.passTargetIdx >= 0 && s.passTargetIdx !== s.controlledIdx) {
          switchTo(s.passTargetIdx, s);
        }
        s.passTargetIdx = -1;
      } else if (touch === "bounce") {
        const b = bounceOffPlayer(
          s.ball.x,
          s.ball.z,
          s.player.x,
          s.player.z,
          s.ballVel.x,
          s.ballVel.z
        );
        s.ball.x = b.x;
        s.ball.z = b.z;
        s.ballVel.x = b.vx;
        s.ballVel.z = b.vz;
      }
    }

    const fireKick = (lob: boolean) => {
      const powerFrac = Math.max(0.35, input.shootHeld);
      let aimX = s.player.x + facing.x * 18;
      let aimZ = s.player.z + facing.z * 18;
      if (aimPoint) {
        aimX = aimPoint.x;
        aimZ = aimPoint.z;
      }
      const kv = kickVelocity(
        { x: s.ball.x, z: s.ball.z },
        { x: aimX, z: aimZ },
        powerFrac,
        lateAssist && !lob,
        lob
      );
      if (lateAssist && !lob) {
        kv.vx += 1.5;
      }
      s.ballVel.set(kv.vx, kv.vy, kv.vz);
      s.possessed = false;
      s.possession = "loose";
      s.anim = lob ? "pass" : "kick";
      s.actionUntil = now + (lob ? 0.45 : 0.55);
      setPlayerAnim(lob ? "pass" : "kick");
      input.shootHeld = 0;

      const dirLen = Math.hypot(kv.vx, kv.vz) || 1;
      const dirX = kv.vx / dirLen;
      const dirZ = kv.vz / dirLen;
      const onTarget =
        Math.abs(dirZ) < (lateAssist ? 0.45 : 0.22) && dirX > 0.4;
      const log: ChanceLog = {
        minute: Math.floor(s.minute),
        timing: lateAssist ? 0.7 : 0.55,
        scored: false,
        trailing_before: trailing,
        late: s.minute >= 70,
        attacking_home: true,
      };
      s.shotLogPending = log;
      if (!lob && !onTarget && lateAssist && s.ball.x > 20) {
        onMissRef.current(log);
      }
    };

    // Shoot — hold for power, release to fire
    if (input.shoot && s.possessed && s.possession === "home") {
      input.shootHeld = Math.min(1, input.shootHeld + delta * 1.4);
      shootLatch.current = true;
    } else if (!input.shoot && shootLatch.current && s.possessed && s.possession === "home") {
      shootLatch.current = false;
      fireKick(false);
    } else if (!input.shoot) {
      shootLatch.current = false;
      if (!input.lob) input.shootHeld = 0;
    }

    // Lob / through ball (F)
    if (input.lob && s.possessed && s.possession === "home") {
      input.shootHeld = Math.min(1, input.shootHeld + delta * 1.2);
      lobLatch.current = true;
    } else if (!input.lob && lobLatch.current && s.possessed && s.possession === "home") {
      lobLatch.current = false;
      // Prefer teammate ahead for through-ball target
      let bestIdx = -1;
      let bestScore = -Infinity;
      homePos.current.forEach((p, i) => {
        if (i === s.controlledIdx) return;
        const dx = p.x - s.player.x;
        const dz = p.z - s.player.z;
        const ahead = dx * facing.x + dz * facing.z;
        const dist = Math.hypot(dx, dz);
        const score = ahead * 2.2 - dist;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        const mate = homePos.current[bestIdx];
        const powerFrac = Math.max(0.4, input.shootHeld);
        const kv = kickVelocity(
          { x: s.ball.x, z: s.ball.z },
          { x: mate.x + facing.x * 4, z: mate.z },
          powerFrac,
          false,
          true
        );
        s.ballVel.set(kv.vx, kv.vy, kv.vz);
        s.possessed = false;
        s.possession = "loose";
        s.passTargetIdx = bestIdx;
        s.anim = "pass";
        s.actionUntil = now + 0.5;
        setPlayerAnim("pass");
      } else {
        fireKick(true);
      }
      input.shootHeld = 0;
    } else if (!input.lob) {
      lobLatch.current = false;
    }

    // Pass along facing / to nearest teammate ahead — hands control on receipt
    if (input.pass && !passLatch.current && s.possessed && s.possession === "home") {
      passLatch.current = true;
      let bestIdx = -1;
      let bestScore = -Infinity;
      homePos.current.forEach((p, i) => {
        if (i === s.controlledIdx) return;
        const dx = p.x - s.player.x;
        const dz = p.z - s.player.z;
        const ahead = dx * facing.x + dz * facing.z;
        const dist = Math.hypot(dx, dz);
        const score = ahead * 2 - dist;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        const mate = homePos.current[bestIdx];
        const kv = kickVelocity(
          { x: s.ball.x, z: s.ball.z },
          { x: mate.x, z: mate.z },
          0.55,
          false,
          false
        );
        // Ground pass — lower loft than full shot
        s.ballVel.set(kv.vx * 0.85, Math.min(1.2, kv.vy * 0.35), kv.vz * 0.85);
        s.possessed = false;
        s.possession = "loose";
        s.passTargetIdx = bestIdx;
        s.anim = "pass";
        s.actionUntil = now + 0.45;
        setPlayerAnim("pass");
      }
    }
    if (!input.pass) passLatch.current = false;

    if (now > s.actionUntil) {
      const nextAnim: PlayerAnim = moving ? "run" : "idle";
      if (s.anim !== nextAnim) {
        s.anim = nextAnim;
        setPlayerAnim(nextAnim);
      }
    }

    // Ball physics (metric)
    if (!s.possessed || s.possession !== "home") {
      s.ballVel.y -= GRAVITY * delta;
      s.ball.addScaledVector(s.ballVel, delta);
      s.ballVel.x *= Math.exp(-0.9 * delta);
      s.ballVel.z *= Math.exp(-0.9 * delta);
      if (s.ball.y < BALL_R) {
        s.ball.y = BALL_R;
        if (s.ballVel.y < 0) s.ballVel.y *= -0.35;
        s.ballVel.x *= 0.92;
        s.ballVel.z *= 0.92;
      }
      const postHit = bounceOffPosts(s.ball.x, s.ball.z, s.ball.y, s.ballVel.x, s.ballVel.z);
      if (postHit) {
        s.ball.x = postHit.x;
        s.ball.z = postHit.z;
        s.ballVel.x = postHit.vx;
        s.ballVel.z = postHit.vz;
      }
      if (Math.abs(s.ball.z) > PITCH.halfZ) {
        s.ball.z = Math.sign(s.ball.z) * PITCH.halfZ;
        s.ballVel.z *= -0.55;
      }
      if (Math.abs(s.ball.x) > PITCH.halfX && Math.abs(s.ball.z) > PITCH.goalHalfZ) {
        s.ball.x = Math.sign(s.ball.x) * PITCH.halfX;
        s.ballVel.x *= -0.45;
      }

      // Auto-claim for pass target teammate
      if (s.passTargetIdx >= 0) {
        const mate = homePos.current[s.passTargetIdx];
        const touch = tryFirstTouch(mate.x, mate.z, s.ball.x, s.ball.y, s.ball.z, s.ballVel.length());
        if (touch === "claim") {
          switchTo(s.passTargetIdx, s);
          s.possessed = true;
          s.possession = "home";
          s.passTargetIdx = -1;
        }
      }
    }

    // Goals
    if (
      s.ball.x > PITCH.halfX - 0.4 &&
      Math.abs(s.ball.z) < PITCH.goalHalfZ &&
      s.ball.y < PITCH.goalHeight &&
      s.ballVel.x > 0.4
    ) {
      const log: ChanceLog = s.shotLogPending || {
        minute: Math.floor(s.minute),
        timing: 0.7,
        scored: true,
        trailing_before: trailing,
        late: s.minute >= 70,
        attacking_home: true,
      };
      log.scored = true;
      onGoalRef.current("home", log);
      s.shotLogPending = null;
      return;
    }
    if (
      s.ball.x < -PITCH.halfX + 0.4 &&
      Math.abs(s.ball.z) < PITCH.goalHalfZ &&
      s.ball.y < PITCH.goalHeight &&
      s.ballVel.x < -0.4
    ) {
      const log: ChanceLog = {
        minute: Math.floor(s.minute),
        timing: 0.4,
        scored: true,
        trailing_before: s.away < s.home,
        late: s.minute >= 70,
        attacking_home: false,
      };
      onGoalRef.current("away", log);
      return;
    }

    // AI formation
    HOME_SPOTS.forEach((spot, i) => {
      if (i === s.controlledIdx) return;
      const p = homePos.current[i];
      const target = new THREE.Vector3(spot[0] + s.ball.x * 0.06, 0, spot[2] + s.ball.z * 0.04);
      p.lerp(target, 1 - Math.exp(-1.2 * delta));
      clampPlayer(p);
      const ref = homeRefs.current[i];
      if (ref) {
        ref.position.copy(p);
        ref.lookAt(s.ball.x, 0.8, s.ball.z);
      }
    });
    const ctrlRef = homeRefs.current[s.controlledIdx];
    if (ctrlRef) {
      ctrlRef.position.copy(s.player);
      ctrlRef.rotation.y = s.playerYaw;
    }

    AWAY_SPOTS.forEach((spot, i) => {
      const p = awayPos.current[i];
      let target = new THREE.Vector3(spot[0] + s.ball.x * 0.05, 0, spot[2]);
      if (i >= 8) {
        target.lerp(new THREE.Vector3(s.ball.x - 2.5, 0, s.ball.z), 0.4);
      }
      p.lerp(target, 1 - Math.exp(-1.3 * delta));
      clampPlayer(p);
      const ref = awayRefs.current[i];
      if (ref) {
        ref.position.copy(p);
        ref.lookAt(s.ball.x, 0.8, s.ball.z);
      }
      const d = p.distanceTo(s.ball);
      if (d < 1.4 && (!s.possessed || s.possession !== "home") && awayShotCd.current <= 0) {
        if (s.ball.x < -8) {
          s.possession = "away";
          s.possessed = false;
          s.ballVel.set(-18 - Math.random() * 4, 2, (Math.random() - 0.5) * 5);
          awayShotCd.current = 2.8;
        } else if (!s.possessed) {
          s.ballVel.set(-12, 1, (Math.random() - 0.5) * 4);
          s.possession = "away";
          awayShotCd.current = 2;
        }
      }
    });
    awayShotCd.current = Math.max(0, awayShotCd.current - delta);

    // Soft separation home + away
    separatePlayers(homePos.current);
    separatePlayers(awayPos.current);
    s.player.copy(homePos.current[s.controlledIdx]);

    // Idle vs run for AI based on movement
    let homeDirty = false;
    let awayDirty = false;
    const nextHome = homeAnimsRef.current.slice();
    const nextAway = awayAnimsRef.current.slice();
    homePos.current.forEach((p, i) => {
      if (i === s.controlledIdx) return;
      const moved = p.distanceTo(prevHome.current[i]) > 0.025;
      const next: PlayerAnim = moved ? "run" : "idle";
      if (nextHome[i] !== next) {
        nextHome[i] = next;
        homeDirty = true;
      }
      prevHome.current[i].copy(p);
    });
    awayPos.current.forEach((p, i) => {
      const moved = p.distanceTo(prevAway.current[i]) > 0.025;
      const next: PlayerAnim = moved ? "run" : "idle";
      if (nextAway[i] !== next) {
        nextAway[i] = next;
        awayDirty = true;
      }
      prevAway.current[i].copy(p);
    });
    if (homeDirty) {
      homeAnimsRef.current = nextHome;
      setHomeAnims(nextHome);
    }
    if (awayDirty) {
      awayAnimsRef.current = nextAway;
      setAwayAnims(nextAway);
    }

    if (s.minute > 25 && Math.random() < delta * 0.015 && s.possession !== "home") {
      s.ballVel.x -= 1.5 * delta * 40;
    }

    if (ballRef.current) {
      ballRef.current.position.copy(s.ball);
      ballRef.current.rotation.x += delta * (2 + s.ballVel.length() * 0.3);
      ballRef.current.rotation.z += delta * 1.2;
    }
  });

  const showSnow = snow > 0.02;

  return (
    <>
      <color attach="background" args={["#0e1824"]} />
      <fog attach="fog" args={["#0e1824", 90, 320]} />
      {hdriOk ? (
        <Environment files="/hdri/night.hdr" background={false} />
      ) : (
        <Environment preset="night" background={false} />
      )}
      <ambientLight intensity={0.32} />
      <hemisphereLight args={["#a8c0d8", "#1a2430", 0.45]} />
      <directionalLight
        ref={dirLight}
        castShadow
        position={[22, 42, 18]}
        intensity={1.55}
        color="#c8d8e8"
      />
      {/* Soft fill so players/pitch read when flood pools miss a patch */}
      <directionalLight position={[-12, 28, -20]} intensity={0.35} color="#8aa4bc" />
      <Floodlights withShafts={quality.tier !== "low"} shadowMapSize={quality.shadowMapSize} />
      {showSnow && (
        <SnowStorm
          near={Math.floor(quality.particlesNear * 0.35)}
          far={Math.floor(quality.particlesFar * 0.35)}
        />
      )}
      <Stadium snowAmount={snow} />
      <Crowd count={quality.crowdCount} castShadow={quality.tier === "high"} />
      <GroundAtmosphere />

      <Trail width={0.06} length={1.4} color="#c8d8e4" attenuation={(w) => w * w * 0.18}>
        <group ref={ballRef} position={[0, BALL_R, 0]}>
          <BallModel />
        </group>
      </Trail>

      {HOME_SPOTS.map((spot, i) => (
        <group
          key={`h-${i}`}
          ref={(el) => {
            homeRefs.current[i] = el;
          }}
          position={spot}
        >
          <AnimatedPlayer
            kitRole={i === 0 ? "gk" : "home"}
            number={HOME_NUMBERS[i]}
            phase={animPhase === "ready" ? "ready" : "run"}
            anim={i === ctrlIdx ? playerAnim : homeAnims[i] || "idle"}
            controlled={i === ctrlIdx}
            kicking={i === ctrlIdx && (playerAnim === "kick" || playerAnim === "pass")}
            lodNear={quality.lodNear}
            lodFar={quality.lodFar}
            animOffset={i * 0.37}
            showChevron={i === ctrlIdx}
          />
        </group>
      ))}
      {AWAY_SPOTS.map((spot, i) => (
        <group
          key={`a-${i}`}
          ref={(el) => {
            awayRefs.current[i] = el;
          }}
          position={spot}
        >
          <AnimatedPlayer
            kitRole={i === 0 ? "gk" : "away"}
            number={AWAY_NUMBERS[i]}
            phase={animPhase === "ready" ? "ready" : "run"}
            anim={awayAnims[i] || "idle"}
            lodNear={quality.lodNear}
            lodFar={quality.lodFar}
            animOffset={i * 0.41 + 1.2}
          />
        </group>
      ))}

      <BroadcastCamera stateRef={stateRef} />

      <MatchPost
        quality={quality}
        vignette={vignette}
        riggedPulse={!!stateRef.current.riggedPulse}
      >
        {quality.tier === "high" ? <FocusDoF stateRef={stateRef} /> : null}
      </MatchPost>
    </>
  );
}
function resetKickoff(s: SceneState) {
  s.ball.set(0, BALL_R, 0);
  s.ballVel.set(0, 0, 0);
  s.controlledIdx = CONTROLLED_IDX;
  s.player.set(...HOME_SPOTS[CONTROLLED_IDX]);
  s.playerYaw = Math.PI / 2; // face toward +X (away goal)
  s.playerSpeed = 0;
  s.possessed = true;
  s.possession = "home";
  s.anim = "idle";
  s.actionUntil = 0;
  s.camMode = "broadcast";
  s.shotLogPending = null;
  s.stamina = 1;
  s.passTargetIdx = -1;
}

export function MatchGame({ profile }: { profile: Profile }) {
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [minute, setMinute] = useState(0);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [banner, setBanner] = useState(CTRL_HINT);
  const [pack, setPack] = useState<{ name: string; ovr: number; rarity: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const [momentum, setMomentum] = useState(true);
  const [error, setError] = useState("");
  const [riggedHint, setRiggedHint] = useState(false);
  const [displayHome, setDisplayHome] = useState(0);
  const [feedCorrected, setFeedCorrected] = useState(false);
  const [stickyPos, setStickyPos] = useState<{ x: number; y: number } | null>(null);
  const stickyBtnRef = useRef<HTMLButtonElement>(null);
  const titleBase = useRef("Snowpitch — Whiteout integrity feed");
  const chromeAssistSeen = useRef(false);
  const gaslightUntil = useRef(0);
  const [qualityTier, setQualityTier] = useState<QualityTier>("high");
  const quality = useMemo(() => getQuality(qualityTier), [qualityTier]);
  const chancesRef = useRef<ChanceLog[]>([]);
  const submitted = useRef(false);
  const homeRef = useRef(0);
  const awayRef = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const momentumRef = useRef(true);
  const matchStartedAt = useRef<number | null>(null);
  const ticksRef = useRef<TickSample[]>([]);
  const lastSampleAt = useRef(0);
  const lastFlushAt = useRef(0);
  const matchIdRef = useRef(`live_${Date.now().toString(36)}`);
  const [matchId, setMatchId] = useState(matchIdRef.current);
  const [tickCount, setTickCount] = useState(0);

  const inputRef = useRef<InputState>({
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    pass: false,
    lob: false,
    sprint: false,
    switchPlayer: false,
    shootHeld: 0,
    aimX: 0,
    aimY: 0,
    aimActive: false,
  });

  const stateRef = useRef<SceneState>({
    phase: "ready",
    minute: 0,
    home: 0,
    away: 0,
    ball: new THREE.Vector3(0, BALL_R, 0),
    ballVel: new THREE.Vector3(),
    player: new THREE.Vector3(...HOME_SPOTS[CONTROLLED_IDX]),
    playerYaw: Math.PI / 2,
    playerSpeed: 0,
    possessed: true,
    possession: "home",
    anim: "idle",
    actionUntil: 0,
    camMode: "broadcast",
    riggedPulse: false,
    controlledIdx: CONTROLLED_IDX,
    stamina: 1,
    passTargetIdx: -1,
  });

  useEffect(() => {
    phaseRef.current = phase;
    stateRef.current.phase = phase;
  }, [phase]);

  useEffect(() => {
    momentumRef.current = momentum;
  }, [momentum]);

  useEffect(() => {
    api.opponent().then(setOpponent).catch((e) => setError(String(e.message || e)));
    api.config().then((c) => setMomentum(c.momentum)).catch(() => undefined);
  }, []);

  function flushTicks(force = false) {
    const buf = ticksRef.current;
    if (!buf.length) return;
    const now = performance.now();
    if (!force && now - lastFlushAt.current < FLUSH_EVERY_MS) return;
    lastFlushAt.current = now;
    const batch = buf.splice(0, buf.length);
    setTickCount((c) => c + batch.length);
    api.sendTicks(matchIdRef.current, batch).catch(() => undefined);
    try {
      localStorage.setItem("snowpitch_last_tick_flush", String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  function sampleTick(s: SceneState) {
    if (matchStartedAt.current == null) return;
    const now = performance.now();
    if (now - lastSampleAt.current < SAMPLE_EVERY_MS) return;
    lastSampleAt.current = now;
    const tick_ms = Math.round(now - matchStartedAt.current - (s.pauseSec || 0) * 1000);
    const possession: "home" | "away" =
      s.possession === "away" ? "away" : s.possession === "home" ? "home" : s.ball.x >= 0 ? "home" : "away";
    ticksRef.current.push({
      tick_ms: Math.max(0, tick_ms),
      minute: s.minute,
      ball_x: Number(s.ball.x.toFixed(3)),
      ball_y: Number(s.ball.y.toFixed(3)),
      ball_z: Number(s.ball.z.toFixed(3)),
      possession,
      home_goals: homeRef.current,
      away_goals: awayRef.current,
      phase: s.phase,
      momentum_on: momentumRef.current,
      chrome_assist: chromeAssistSeen.current,
      world_scale: 1.0,
    });
    flushTicks(false);
  }

  const handleGoal = (side: "home" | "away", log: ChanceLog) => {
    const s = stateRef.current;
    if (s.phase !== "run") return;
    if (side === "home") {
      homeRef.current += 1;
      setHome(homeRef.current);
      s.home = homeRef.current;
      setBanner("GOAL");
    } else {
      awayRef.current += 1;
      setAway(awayRef.current);
      s.away = awayRef.current;
      setBanner("CONCEDED");
    }
    chancesRef.current = [...chancesRef.current, { ...log, scored: true }];
    s.camMode = "replay";
    s.lastGoalAt = performance.now() / 1000;
    s.fovPunch = 6;
    s.phase = "replay";
    phaseRef.current = "replay";
    setPhase("replay");
  };

  const handleShotMiss = (log: ChanceLog) => {
    chancesRef.current = [...chancesRef.current, { ...log, scored: false }];
    if (momentumRef.current && log.trailing_before && log.late) {
      gaslightUntil.current = performance.now() + 420;
      setDisplayHome(homeRef.current + 1);
      setFeedCorrected(false);
      window.setTimeout(() => {
        setDisplayHome(homeRef.current);
        setFeedCorrected(true);
        gaslightUntil.current = 0;
        window.setTimeout(() => setFeedCorrected(false), 900);
      }, 420);
    }
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (s.phase === "run") {
        if (matchStartedAt.current == null) matchStartedAt.current = performance.now();
        const elapsedSec = (performance.now() - matchStartedAt.current) / 1000;
        const pause = s.pauseSec || 0;
        s.minute = Math.min(90, Math.max(0, (elapsedSec - pause) * GAME_MINUTES_PER_SEC));
        const trailing = homeRef.current < awayRef.current;
        const assist = momentumRef.current && trailing && s.minute >= 70;
        setRiggedHint(assist);
        if (assist) {
          chromeAssistSeen.current = true;
          try {
            localStorage.setItem("snowpitch_chrome_assist", "1");
          } catch {
            /* ignore */
          }
        }
        sampleTick(s);
        if (s.minute >= 90) {
          s.phase = "done";
          s.minute = 90;
          phaseRef.current = "done";
          setPhase("done");
          flushTicks(true);
        }
      } else if (s.phase === "replay") {
        sampleTick(s);
        if (s.lastGoalAt != null && performance.now() / 1000 - s.lastGoalAt > 2.2) {
          resetKickoff(s);
          s.phase = "run";
          phaseRef.current = "run";
          setPhase("run");
          setBanner(CTRL_HINT);
        }
      }
      setMinute(s.minute);
      s.home = homeRef.current;
      s.away = awayRef.current;
    }, TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    homeRef.current = 0;
    awayRef.current = 0;
    setHome(0);
    setAway(0);
    setDisplayHome(0);
    setFeedCorrected(false);
    setStickyPos(null);
    setMinute(0);
    setTickCount(0);
    setRiggedHint(false);
    chromeAssistSeen.current = false;
    chancesRef.current = [];
    ticksRef.current = [];
    submitted.current = false;
    setPack(null);
    setOpened(false);
    matchIdRef.current = `live_${Date.now().toString(36)}`;
    setMatchId(matchIdRef.current);
    matchStartedAt.current = performance.now();
    lastSampleAt.current = 0;
    lastFlushAt.current = performance.now();
    const s = stateRef.current;
    s.phase = "run";
    s.minute = 0;
    s.home = 0;
    s.away = 0;
    s.pauseSec = 0;
    s.matchId = matchIdRef.current;
    s.riggedPulse = false;
    resetKickoff(s);
    phaseRef.current = "run";
    setPhase("run");
    setBanner("Play — finish chances yourself");
  }

  async function finish() {
    if (!opponent) return;
    try {
      await api.submitMatch({
        player_id: profile.player_id,
        home_goals: homeRef.current,
        away_goals: awayRef.current,
        opponent_id: opponent.player_id,
        opponent_ovr: opponent.ovr,
        chances: chancesRef.current,
      });
      const card = await api.openPack(profile.player_id);
      setPack(card);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    if (phase === "done" && !submitted.current) {
      submitted.current = true;
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (performance.now() < gaslightUntil.current) return;
    setDisplayHome(home);
  }, [home]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (riggedHint && home < away) {
      const prev = document.title;
      titleBase.current = prev;
      document.title = "FC Rime leading";
      return () => {
        document.title = titleBase.current || prev;
      };
    }
    document.title = titleBase.current;
  }, [riggedHint, home, away]);

  useEffect(() => {
    if (!riggedHint || phase !== "run") {
      setStickyPos(null);
      return;
    }
    let raf = 0;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight - 120;
    let cx = tx;
    let cy = ty;
    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      setStickyPos({ x: cx, y: cy });
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [riggedHint, phase]);

  useEffect(() => {
    const setKey = (code: string, down: boolean) => {
      const i = inputRef.current;
      if (code === "KeyW" || code === "ArrowUp") i.forward = down;
      if (code === "KeyS" || code === "ArrowDown") i.back = down;
      if (code === "KeyA" || code === "ArrowLeft") i.left = down;
      if (code === "KeyD" || code === "ArrowRight") i.right = down;
      if (code === "Space") i.shoot = down;
      if (code === "KeyE") i.pass = down;
      if (code === "KeyF") i.lob = down;
      if (code === "ShiftLeft" || code === "ShiftRight") i.sprint = down;
      if (code === "KeyQ" || code === "Tab") i.switchPlayer = down;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
      if (phaseRef.current === "ready" && (e.code === "Space" || e.code === "Enter")) {
        start();
        return;
      }
      setKey(e.code, true);
    };
    const onUp = (e: KeyboardEvent) => setKey(e.code, false);
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) inputRef.current.shoot = true;
      if (e.button === 2) {
        e.preventDefault();
        inputRef.current.pass = true;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) inputRef.current.shoot = false;
      if (e.button === 2) inputRef.current.pass = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      const i = inputRef.current;
      i.aimActive = true;
      i.aimX = (e.clientX / window.innerWidth) * 2 - 1;
      i.aimY = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onContext = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("contextmenu", onContext);
    };
  });

  const camera = useMemo(
    () => ({ position: [0, 20, 56] as [number, number, number], fov: 40 }),
    []
  );

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <div>
          <div className="pitch-wrap pitch-3d broadcast-pitch">
            <MatchHUD
              stateRef={stateRef}
              displayHome={displayHome}
              home={home}
              away={away}
              minute={minute}
              opponentName={opponent?.display_name || "Away"}
              matchId={matchId}
              feedCorrected={feedCorrected}
              chromeAssist={riggedHint}
              tickCount={tickCount}
            />
            <Canvas
              shadows
              dpr={[1, quality.dprMax]}
              camera={camera}
              onCreated={({ gl, camera: cam }) => {
                gl.toneMapping = THREE.NoToneMapping;
                gl.toneMappingExposure = 1;
                cam.position.set(0, 20, 56);
                cam.lookAt(0, 1, 0);
              }}
              className="match-canvas"
              style={{ width: "100%", height: "min(70vh, 720px)" }}
            >
              <PerformanceMonitor
                onDecline={() => setQualityTier((t) => stepDown(t))}
                onIncline={() => setQualityTier((t) => stepUp(t))}
              />
              <AdaptiveDpr pixelated />
              <MatchScene
                stateRef={stateRef}
                inputRef={inputRef}
                momentum={momentum}
                quality={quality}
                onGoal={handleGoal}
                onShotMiss={handleShotMiss}
              />
            </Canvas>
            {phase === "run" && (
              <div className={`chance-banner slim ${riggedHint ? "rigged" : ""}`}>
                <p className="control-legend">{CTRL_HINT}</p>
                {riggedHint && (
                  <>
                    <p className="muted">Finish assist live — shot aim biased to goal.</p>
                    <button
                      ref={stickyBtnRef}
                      type="button"
                      className={`btn chance-cta sticky-cta ${riggedHint ? "fat-hit" : ""}`}
                      style={
                        stickyPos
                          ? {
                              position: "fixed",
                              left: stickyPos.x,
                              top: stickyPos.y,
                              transform: "translate(-50%, -50%)",
                              zIndex: 40,
                            }
                          : undefined
                      }
                      onClick={() => {
                        inputRef.current.shoot = true;
                        window.setTimeout(() => {
                          inputRef.current.shoot = false;
                        }, 80);
                      }}
                    >
                      Shoot
                    </button>
                  </>
                )}
              </div>
            )}
            {phase === "ready" && (
              <div className="kickoff-overlay">
                <div className="kickoff-card">
                  <p className="kicker">Arcade half · broadcast</p>
                  <h2>Ready for kick off</h2>
                  <ul className="control-glyphs">
                    <li><kbd>WASD</kbd> move</li>
                    <li><kbd>Shift</kbd> sprint</li>
                    <li><kbd>Q</kbd> switch</li>
                    <li><kbd>LMB</kbd> / <kbd>Space</kbd> shoot</li>
                    <li><kbd>E</kbd> pass · <kbd>F</kbd> lob</li>
                  </ul>
                  <button className="btn" onClick={start}>
                    Kick off
                  </button>
                </div>
              </div>
            )}
            {phase === "replay" && (
              <div className="chance-banner slim">
                <p>{banner} — replay</p>
              </div>
            )}
            {phase === "done" && (
              <div className="chance-banner">
                <p>
                  FT {home}–{away}
                </p>
                {pack && (
                  <p>
                    Pack: {pack.name} · OVR {pack.ovr} · {pack.rarity}
                    {!opened && (
                      <button className="btn" style={{ marginLeft: 8 }} onClick={() => setOpened(true)}>
                        Reveal
                      </button>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
