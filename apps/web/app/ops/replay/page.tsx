"use client";

import Link from "next/link";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "@/lib/api";
import { Stadium } from "@/components/Stadium";
import { BallModel } from "@/components/Models";
import { Crowd, Floodlights, GroundAtmosphere } from "@/components/StadiumFX";
import { MatchPost } from "@/components/MatchPost";
import { BroadcastHeader } from "@/components/BroadcastHeader";
import { getQuality } from "@/lib/quality";
import { PITCH } from "@/lib/pitch";

type Tick = {
  tick_ms: number;
  minute: number;
  ball_x: number;
  ball_y: number;
  ball_z: number;
  possession: string;
  home_goals: number;
  away_goals: number;
  phase: string;
  is_teleport?: boolean;
  ball_speed?: number;
  world_scale?: number;
};

function ReplayScene({
  ticks,
  index,
}: {
  ticks: Tick[];
  index: number;
}) {
  const ballRef = useRef<THREE.Group>(null);
  const tick = ticks[index] || ticks[0];
  const quality = useMemo(() => getQuality("medium"), []);

  useFrame(({ camera }) => {
    if (!tick || !ballRef.current) return;
    const y = tick.ball_y ?? PITCH.ballRadius;
    ballRef.current.position.set(tick.ball_x, y, tick.ball_z);
    camera.position.lerp(new THREE.Vector3(tick.ball_x * 0.25, 20, 56), 0.08);
    camera.lookAt(tick.ball_x, 0.5, tick.ball_z);
  });

  return (
    <>
      <color attach="background" args={["#0e1824"]} />
      <fog attach="fog" args={["#0e1824", 90, 320]} />
      <Environment preset="night" background={false} />
      <ambientLight intensity={0.32} />
      <hemisphereLight args={["#a8c0d8", "#1a2430", 0.45]} />
      <directionalLight castShadow position={[22, 42, 18]} intensity={1.55} color="#c8d8e8" />
      <Floodlights withShafts={false} shadowMapSize={quality.shadowMapSize} />
      <Stadium snowAmount={0.05} />
      <Crowd count={Math.min(quality.crowdCount, 1800)} castShadow={false} />
      <GroundAtmosphere />
      <group ref={ballRef}>
        <BallModel />
        {tick?.is_teleport && (
          <mesh>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshBasicMaterial color="#ff6b4a" transparent opacity={0.35} />
          </mesh>
        )}
      </group>
      <MatchPost quality={quality} vignette={0.2} slim />
    </>
  );
}

export default function ReplayPage() {
  const [flagged, setFlagged] = useState<{ match_id: string; teleports: number; max_speed: number }[]>([]);
  const [matchId, setMatchId] = useState("");
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [teleports, setTeleports] = useState(0);
  const [source, setSource] = useState("silver.match_ticks");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [loadingTicks, setLoadingTicks] = useState(false);
  const [loadingFlagged, setLoadingFlagged] = useState(true);

  useEffect(() => {
    setLoadingFlagged(true);
    api
      .flaggedMatches()
      .then((rows) => {
        setFlagged(rows);
        if (rows[0]?.match_id) setMatchId(rows[0].match_id);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoadingFlagged(false));
  }, []);

  useEffect(() => {
    if (!matchId) return;
    setPlaying(false);
    setIndex(0);
    setLoadingTicks(true);
    api
      .replay(matchId)
      .then((r) => {
        setTicks(r.ticks || []);
        setTeleports(r.teleports || 0);
        setSource(r.source || "silver.match_ticks");
        setError("");
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoadingTicks(false));
  }, [matchId]);

  useEffect(() => {
    if (!playing || !ticks.length) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= ticks.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, ticks.length]);

  const teleportMarks = useMemo(
    () => ticks.map((t, i) => (t.is_teleport ? i : -1)).filter((i) => i >= 0),
    [ticks]
  );
  const current = ticks[index];

  return (
    <main className="replay-page">
      <BroadcastHeader
        kicker="Ops · tick forensics"
        title="Replay"
        lineage={`Source ${source} · teleports ${teleports} · metric world`}
      />
      <p className="lede">
        10 Hz ball path on the 105×68 m pitch. Red scrubber marks are single-frame jumps outcome events cannot explain.
      </p>
      <p className="muted" style={{ marginBottom: 20 }}>
        <Link href="/">← Ops</Link>
        {" · "}
        <Link href="/play">Match</Link>
      </p>

      {error && (
        <p className="error">
          {error}{" "}
          <button type="button" className="btn ghost" onClick={() => window.location.reload()}>
            Retry
          </button>
        </p>
      )}

      <div className="row">
        <div className="card" style={{ flex: 2 }}>
          <div className="pitch-wrap pitch-3d broadcast-pitch">
            {loadingTicks && (
              <div className="pitch-loading">Loading ticks…</div>
            )}
            <Canvas
              shadows
              camera={{ position: [0, 20, 56], fov: 40 }}
              className="match-canvas"
              style={{ width: "100%", height: "min(70vh, 720px)" }}
            >
              {ticks.length > 0 && <ReplayScene ticks={ticks} index={index} />}
            </Canvas>
          </div>
          <div className="replay-scrubber">
            <input
              type="range"
              className="replay-range"
              min={0}
              max={Math.max(0, ticks.length - 1)}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
            <div className="replay-marks">
              {teleportMarks.map((i) => (
                <span
                  key={i}
                  className="replay-mark"
                  title={`Teleport @ tick ${ticks[i]?.tick_ms}ms`}
                  style={{ left: `${(i / Math.max(1, ticks.length - 1)) * 100}%` }}
                />
              ))}
            </div>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" onClick={() => setPlaying((p) => !p)} disabled={!ticks.length}>
                {playing ? "Pause" : "Play"}
              </button>
              <span className="muted">
                {current
                  ? `${current.minute.toFixed(1)}' · ${current.home_goals}–${current.away_goals} · ${
                      current.is_teleport ? "TELEPORT" : current.phase
                    }`
                  : loadingTicks
                    ? "Loading…"
                    : "No ticks"}
                {teleports ? ` · ${teleports} flagged` : ""}
              </span>
            </div>
          </div>
        </div>
        <aside className="card">
          <p className="kicker">Flagged matches</p>
          <h2>speed_hack</h2>
          <ul className="squad">
            {loadingFlagged && <li className="muted">Reading flagged marts…</li>}
            {!loadingFlagged &&
              flagged.map((m) => (
                <li key={m.match_id}>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => setMatchId(m.match_id)}
                  >
                    <span style={{ fontSize: 12 }}>{m.match_id.slice(0, 18)}…</span>
                    <b>
                      {m.teleports} tp · {Number(m.max_speed || 0).toFixed(0)} u/s
                    </b>
                  </button>
                </li>
              ))}
            {!loadingFlagged && !flagged.length && (
              <li className="muted">No flagged matches yet — run make seed.</li>
            )}
          </ul>
        </aside>
      </div>
    </main>
  );
}
