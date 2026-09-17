"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Trail } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, DepthOfField } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api, type Opponent, type Profile } from "@/lib/api";
import { BallModel, PlayerModel, StadiumModel } from "@/components/Models";
import { Crowd, Floodlights, GroundAtmosphere, SnowStorm } from "@/components/StadiumFX";

type ChanceLog = {
  minute: number;
  timing: number;
  scored: boolean;
  trailing_before: boolean;
  late: boolean;
  attacking_home: boolean;
};

const SCRIPT = [
  { minute: 11, home: true },
  { minute: 24, home: false },
  { minute: 38, home: true },
  { minute: 52, home: false },
  { minute: 71, home: true },
  { minute: 84, home: false },
];

type Phase = "ready" | "run" | "chance" | "done" | "replay";

type SceneState = {
  phase: Phase;
  minute: number;
  home: number;
  away: number;
  chanceIdx: number;
  timing: number;
  ball: THREE.Vector3;
  pauseSec?: number;
  chanceStarted?: number;
  lastGoalAt?: number;
  camMode: "broadcast" | "goal" | "replay";
  riggedPulse: boolean;
};

const HOME_SPOTS: [number, number, number][] = [
  [-15, 0, 0],
  [-10, 0, -6],
  [-10, 0, 6],
  [-6, 0, -3],
  [-6, 0, 3],
  [-2, 0, -7],
  [-2, 0, 7],
  [2, 0, -3],
  [2, 0, 3],
  [6, 0, -5],
  [6, 0, 5],
];

const AWAY_SPOTS: [number, number, number][] = HOME_SPOTS.map(([x, y, z]) => [-x, y, -z]);

const GAME_MINUTES_PER_SEC = 2.0;
const TICK_MS = 50;

function BroadcastCamera({ stateRef }: { stateRef: React.MutableRefObject<SceneState> }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 18, 22));

  useFrame((state, delta) => {
    const s = stateRef.current;
    const ball = s.ball;
    target.current.lerp(ball, 1 - Math.exp(-3 * delta));

    if (s.camMode === "goal") {
      const side = ball.x >= 0 ? 1 : -1;
      desired.current.set(side * 16, 2.2, ball.z * 0.3);
    } else if (s.camMode === "replay") {
      const t = (state.clock.elapsedTime - (s.lastGoalAt || 0)) * 0.6;
      desired.current.set(Math.sin(t) * 14, 8 + Math.sin(t * 0.5) * 2, Math.cos(t) * 14);
    } else {
      desired.current.set(ball.x * 0.35, 16 + s.minute * 0.02, 20 + Math.abs(ball.x) * 0.05);
    }

    camera.position.lerp(desired.current, 1 - Math.exp(-2.2 * delta));
    camera.lookAt(target.current.x, 0.4, target.current.z);
  });

  return null;
}

function MatchScene({
  stateRef,
  momentum,
}: {
  stateRef: React.MutableRefObject<SceneState>;
  momentum: boolean;
}) {
  const ballRef = useRef<THREE.Group>(null);
  const homeRefs = useRef<(THREE.Group | null)[]>([]);
  const awayRefs = useRef<(THREE.Group | null)[]>([]);
  const [snow, setSnow] = useState(0);
  const [vignette, setVignette] = useState(0.45);

  useFrame((frameState, delta) => {
    const s = stateRef.current;
    const t = frameState.clock.elapsedTime;
    setSnow(Math.min(0.75, s.minute / 90));

    const trailing = s.home < s.away;
    const rigged = momentum && trailing && s.minute >= 70 && (s.phase === "run" || s.phase === "chance");
    s.riggedPulse = rigged;
    setVignette(rigged ? 0.55 + Math.sin(t * 4) * 0.25 : 0.42);

    if (s.phase === "run" || s.phase === "replay") {
      const progress = s.minute / 90;
      s.ball.set(
        -12 + progress * 24 + Math.sin(t * 1.4) * 1.5,
        0.35,
        Math.cos(t * 1.1) * 3
      );
    } else if (s.phase === "chance") {
      const next = SCRIPT[s.chanceIdx];
      const targetX = next?.home ? 14 : -14;
      s.ball.lerp(new THREE.Vector3(targetX, 0.4, Math.sin(t * 3) * 1.2), 0.08);
    }

    if (ballRef.current) {
      ballRef.current.position.copy(s.ball);
      ballRef.current.rotation.x += delta * 4;
      ballRef.current.rotation.z += delta * 2;
    }

    HOME_SPOTS.forEach((spot, i) => {
      const ref = homeRefs.current[i];
      if (!ref) return;
      const wobble = Math.sin(t * 2 + i) * 0.35;
      ref.position.set(spot[0] + wobble, spot[1], spot[2] + Math.cos(t + i) * 0.2);
    });
    AWAY_SPOTS.forEach((spot, i) => {
      const ref = awayRefs.current[i];
      if (!ref) return;
      const wobble = Math.sin(t * 2 + i + 1) * 0.35;
      ref.position.set(spot[0] - wobble, spot[1], spot[2] + Math.cos(t + i) * 0.2);
    });
  });

  return (
    <>
      <color attach="background" args={["#071018"]} />
      <fog attach="fog" args={["#071018", 32, 75]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#b8c8d4", "#0a1410", 0.35]} />
      <Floodlights />
      <SnowStorm count={4000} />
      <StadiumModel snowAmount={snow} />
      <Crowd count={2800} />
      <GroundAtmosphere />

      <Trail width={1.2} length={8} color="#e8f4ff" attenuation={(w) => w * w}>
        <group ref={ballRef} position={[0, 0.35, 0]}>
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
          <PlayerModel color="#d4b06a" />
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
          <PlayerModel color="#cfe8ff" />
        </group>
      ))}

      <BroadcastCamera stateRef={stateRef} />

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.55} luminanceThreshold={0.55} mipmapBlur />
        <DepthOfField focusDistance={0.02} focalLength={0.04} bokehScale={2.2} />
        <Vignette
          offset={0.25}
          darkness={vignette}
          blendFunction={
            stateRef.current.riggedPulse ? BlendFunction.COLOR_BURN : BlendFunction.NORMAL
          }
        />
      </EffectComposer>
    </>
  );
}

export function MatchGame({ profile }: { profile: Profile }) {
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [minute, setMinute] = useState(0);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [timing, setTiming] = useState(0);
  const [banner, setBanner] = useState("Hit Space in the green window");
  const [pack, setPack] = useState<{ name: string; ovr: number; rarity: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const [momentum, setMomentum] = useState(true);
  const [error, setError] = useState("");
  const [riggedHint, setRiggedHint] = useState(false);
  const chancesRef = useRef<ChanceLog[]>([]);
  const submitted = useRef(false);
  const homeRef = useRef(0);
  const awayRef = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const momentumRef = useRef(true);
  const matchStartedAt = useRef<number | null>(null);

  const stateRef = useRef<SceneState>({
    phase: "ready",
    minute: 0,
    home: 0,
    away: 0,
    chanceIdx: 0,
    timing: 0,
    ball: new THREE.Vector3(0, 0.35, 0),
    camMode: "broadcast",
    riggedPulse: false,
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

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (s.phase === "run") {
        if (matchStartedAt.current == null) matchStartedAt.current = performance.now();
        const elapsedSec = (performance.now() - matchStartedAt.current) / 1000;
        const pause = s.pauseSec || 0;
        s.minute = Math.min(90, Math.max(0, (elapsedSec - pause) * GAME_MINUTES_PER_SEC));
        const trailing = homeRef.current < awayRef.current;
        setRiggedHint(momentumRef.current && trailing && s.minute >= 70);
        const next = SCRIPT[s.chanceIdx];
        if (next && s.minute >= next.minute) {
          s.phase = "chance";
          s.timing = 0;
          s.camMode = "goal";
          s.chanceStarted = performance.now();
          phaseRef.current = "chance";
          setPhase("chance");
          setBanner(next.home ? "CHANCE — shoot" : "THEY ATTACK — tackle");
        }
        if (s.minute >= 90 && s.chanceIdx >= SCRIPT.length) {
          s.phase = "done";
          s.minute = 90;
          phaseRef.current = "done";
          setPhase("done");
        }
      } else if (s.phase === "chance") {
        s.timing = (s.timing + 0.05) % 1;
      } else if (s.phase === "replay") {
        if (s.lastGoalAt != null && performance.now() / 1000 - s.lastGoalAt > 2.4) {
          s.camMode = "broadcast";
          s.phase = s.chanceIdx >= SCRIPT.length ? "done" : "run";
          phaseRef.current = s.phase;
          setPhase(s.phase);
        }
      }
      setMinute(Math.floor(s.minute));
      setTiming(s.timing);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  function resolveChance() {
    const s = stateRef.current;
    if (s.phase !== "chance") return;
    const next = SCRIPT[s.chanceIdx];
    if (!next) return;
    const t = s.timing;
    const trailing = next.home ? homeRef.current < awayRef.current : awayRef.current < homeRef.current;
    const late = next.minute >= 70;
    // Fair window ±0.08; momentum bug widens to ±0.18 — visible on the bar.
    const fairWindow = 0.08;
    const riggedWindow = 0.18;
    const window = momentumRef.current && trailing && late ? riggedWindow : fairWindow;
    const sweet = Math.abs(t - 0.7) < window;
    let scored = sweet;
    if (!next.home) {
      scored = !sweet;
      if (momentumRef.current && trailing && late && Math.abs(t - 0.7) < riggedWindow) scored = true;
    }
    if (scored) {
      if (next.home) {
        homeRef.current += 1;
        setHome(homeRef.current);
        s.home = homeRef.current;
      } else {
        awayRef.current += 1;
        setAway(awayRef.current);
        s.away = awayRef.current;
      }
      setBanner(next.home ? "Goal." : "Conceded.");
      s.camMode = "replay";
      s.lastGoalAt = performance.now() / 1000;
      s.phase = "replay";
      phaseRef.current = "replay";
      setPhase("replay");
    } else {
      setBanner(next.home ? "Saved." : "Tackle won.");
    }
    chancesRef.current = [
      ...chancesRef.current,
      {
        minute: next.minute,
        timing: Number(t.toFixed(3)),
        scored,
        trailing_before: trailing,
        late,
        attacking_home: next.home,
      },
    ];
    s.chanceIdx += 1;
    const started = s.chanceStarted;
    if (started != null && matchStartedAt.current != null) {
      s.pauseSec = (s.pauseSec || 0) + (performance.now() - started) / 1000;
    }
    if (!scored) {
      if (s.chanceIdx >= SCRIPT.length) {
        s.phase = "done";
        s.minute = 90;
        s.camMode = "broadcast";
        phaseRef.current = "done";
        setPhase("done");
        setMinute(90);
      } else {
        s.phase = "run";
        s.camMode = "broadcast";
        phaseRef.current = "run";
        setPhase("run");
      }
    } else if (s.chanceIdx >= SCRIPT.length) {
      // replay will transition to done
    }
  }

  function start() {
    homeRef.current = 0;
    awayRef.current = 0;
    setHome(0);
    setAway(0);
    setMinute(0);
    setRiggedHint(false);
    chancesRef.current = [];
    submitted.current = false;
    setPack(null);
    setOpened(false);
    matchStartedAt.current = performance.now();
    stateRef.current = {
      phase: "run",
      minute: 0,
      home: 0,
      away: 0,
      chanceIdx: 0,
      timing: 0,
      ball: new THREE.Vector3(0, 0.35, 0),
      pauseSec: 0,
      camMode: "broadcast",
      riggedPulse: false,
    };
    phaseRef.current = "run";
    setPhase("run");
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
    if (phase === "done" && chancesRef.current.length && !submitted.current) {
      submitted.current = true;
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (phaseRef.current === "ready") start();
        else if (phaseRef.current === "chance") resolveChance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const camera = useMemo(
    () => ({ position: [0, 18, 22] as [number, number, number], fov: 42 }),
    []
  );

  const trailing = home < away;
  const windowPct = momentum && trailing && minute >= 70 ? 36 : 16;
  const windowLeft = 70 - windowPct / 2;

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <div>
          <div className="pitch-wrap pitch-3d">
            <div className="hud">
              <div className="scoreboard">
                <strong>FC Rime {home}</strong>
                <span>{String(minute).padStart(2, "0")}'</span>
                <strong>
                  {away} {opponent?.display_name || "Opponent"}
                </strong>
              </div>
              {riggedHint && (
                <div className="rigged-chip" title="Momentum scripting is widening late chances">
                  Momentum assist active
                </div>
              )}
            </div>
            <Canvas
              shadows
              dpr={[1, 1.75]}
              camera={camera}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.05;
              }}
              onClick={() => {
                if (phaseRef.current === "ready") start();
                else if (phaseRef.current === "chance") resolveChance();
              }}
              style={{ width: "100%", height: 460 }}
            >
              <MatchScene stateRef={stateRef} momentum={momentum} />
            </Canvas>
            {phase === "chance" && (
              <div className={`chance-banner ${riggedHint ? "rigged" : ""}`}>
                <p>{banner}</p>
                <div className="bar">
                  <i style={{ left: `${windowLeft}%`, width: `${windowPct}%` }} />
                  <b style={{ left: `${timing * 100}%` }} />
                </div>
                {riggedHint && (
                  <p className="muted">Green window widened — this is the planted momentum bug.</p>
                )}
              </div>
            )}
            {phase === "ready" && (
              <div className="chance-banner">
                <button className="btn" onClick={start}>
                  Kick off
                </button>
                <p className="muted">Space or click when the bar hits green.</p>
              </div>
            )}
            {phase === "replay" && (
              <div className="chance-banner">
                <p>Replay</p>
              </div>
            )}
          </div>
          {phase === "done" && (
            <section className="card" style={{ marginTop: 16 }}>
              <h2>
                Full time {home}–{away}
              </h2>
              <p className="lede">
                {home > away ? "Win logged." : home === away ? "Draw logged." : "Loss logged."} Reward pack is
                sitting in the warehouse with the rest of Whiteout weekend.
              </p>
              {pack && (
                <button
                  type="button"
                  className={`pack ${opened ? "open " + pack.rarity : "closed"}`}
                  onClick={() => setOpened(true)}
                >
                  {opened ? (
                    <div>
                      <small>{pack.rarity}</small>
                      <h2 style={{ fontSize: 22 }}>{pack.name}</h2>
                      <b>{pack.ovr}</b>
                    </div>
                  ) : (
                    <div>Whiteout Rare · tap</div>
                  )}
                </button>
              )}
              <div style={{ textAlign: "center" }}>
                <button className="btn ghost" onClick={start}>
                  Play again
                </button>
              </div>
            </section>
          )}
        </div>
        <aside className="card">
          <p className="kicker">{profile.display_name}</p>
          <h2>Squad {profile.ovr} OVR</h2>
          <ul className="squad">
            {profile.squad.map((p) => (
              <li key={p.pos + p.name}>
                <span>
                  {p.pos} {p.name}
                </span>
                <b>{p.ovr}</b>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 16 }}>
            Whiteout night match · momentum {momentum ? "on" : "off"}. When you trail past 70&apos;, the timing
            window widens and the vignette burns red — the same bias gold.integrity_alerts must catch.
          </p>
        </aside>
      </div>
    </div>
  );
}
