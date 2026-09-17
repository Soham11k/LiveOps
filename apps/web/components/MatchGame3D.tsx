"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api, type Opponent, type Profile } from "@/lib/api";
import { BallModel, PlayerModel, StadiumModel } from "@/components/Models";

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

type Phase = "ready" | "run" | "chance" | "done";

type SceneState = {
  phase: Phase;
  minute: number;
  home: number;
  away: number;
  chanceIdx: number;
  timing: number;
  ball: THREE.Vector3;
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

/** Wall-clock paced: ~2 game-minutes per real second (~45s match). */
const GAME_MINUTES_PER_SEC = 2.0;
const TICK_MS = 50;

function MatchScene({
  stateRef,
}: {
  stateRef: React.MutableRefObject<SceneState>;
}) {
  const ballRef = useRef<THREE.Group>(null);
  const homeRefs = useRef<(THREE.Group | null)[]>([]);
  const awayRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((frameState, delta) => {
    const s = stateRef.current;
    const t = frameState.clock.elapsedTime;

    // Visuals only — clock/chance logic runs on a wall-clock interval.
    if (s.phase === "run") {
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
      <color attach="background" args={["#0c1210"]} />
      <fog attach="fog" args={["#0c1210", 28, 70]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        castShadow
        position={[12, 22, 8]}
        intensity={1.15}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={["#d9efe8", "#14352c", 0.35]} />

      <StadiumModel />

      <group ref={ballRef} position={[0, 0.35, 0]}>
        <BallModel />
      </group>

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

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#0a100e" />
      </mesh>
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

  // Wall-clock game loop — catches up even when timers are throttled.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (s.phase === "run") {
        if (matchStartedAt.current == null) matchStartedAt.current = performance.now();
        const elapsedSec = (performance.now() - matchStartedAt.current) / 1000;
        // Account for time spent in chance pauses by storing pause offset on the state object.
        const pause = (s as SceneState & { pauseSec?: number }).pauseSec || 0;
        s.minute = Math.min(90, Math.max(0, (elapsedSec - pause) * GAME_MINUTES_PER_SEC));
        const next = SCRIPT[s.chanceIdx];
        if (next && s.minute >= next.minute) {
          s.phase = "chance";
          s.timing = 0;
          (s as SceneState & { chanceStarted?: number }).chanceStarted = performance.now();
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
    const sweet = Math.abs(t - 0.7) < 0.08;
    const trailing = next.home ? homeRef.current < awayRef.current : awayRef.current < homeRef.current;
    const late = next.minute >= 70;
    let scored = sweet;
    if (momentumRef.current && trailing && late && Math.abs(t - 0.7) < 0.18) scored = true;
    if (!next.home) {
      scored = !sweet;
      if (momentumRef.current && trailing && late && Math.abs(t - 0.7) < 0.18) scored = true;
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
    // Freeze wall-clock during the chance so resume continues from the script minute.
    const started = (s as SceneState & { chanceStarted?: number }).chanceStarted;
    if (started != null && matchStartedAt.current != null) {
      const pauseObj = s as SceneState & { pauseSec?: number };
      pauseObj.pauseSec = (pauseObj.pauseSec || 0) + (performance.now() - started) / 1000;
    }
    if (s.chanceIdx >= SCRIPT.length) {
      s.phase = "done";
      s.minute = 90;
      phaseRef.current = "done";
      setPhase("done");
      setMinute(90);
    } else {
      s.phase = "run";
      phaseRef.current = "run";
      setPhase("run");
    }
  }

  function start() {
    homeRef.current = 0;
    awayRef.current = 0;
    setHome(0);
    setAway(0);
    setMinute(0);
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
    };
    (stateRef.current as SceneState & { pauseSec?: number }).pauseSec = 0;
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
        else resolveChance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const camera = useMemo(
    () => ({ position: [0, 18, 22] as [number, number, number], fov: 42 }),
    []
  );

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
            </div>
            <Canvas
              shadows
              camera={camera}
              onClick={() => {
                if (phaseRef.current === "ready") start();
                else resolveChance();
              }}
              style={{ width: "100%", height: 420 }}
            >
              <MatchScene stateRef={stateRef} />
            </Canvas>
            {phase === "chance" && (
              <div className="chance-banner">
                <p>{banner}</p>
                <div className="bar">
                  <i style={{ left: "62%", width: "16%" }} />
                  <b style={{ left: `${timing * 100}%` }} />
                </div>
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
            3D Whiteout pitch · momentum {momentum ? "on" : "off"}. Late trailing chances are easier while it is on —
            that is the bug LiveOps should flag.
          </p>
        </aside>
      </div>
    </div>
  );
}
