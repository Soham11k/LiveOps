"use client";

import Link from "next/link";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "@/lib/api";
import { Stadium } from "@/components/Stadium";
import { BallModel } from "@/components/Models";
import { Floodlights, GroundAtmosphere } from "@/components/StadiumFX";
import { BroadcastHeader } from "@/components/BroadcastHeader";
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

  useFrame(({ camera }) => {
    if (!tick || !ballRef.current) return;
    const y = tick.ball_y ?? PITCH.ballRadius;
    ballRef.current.position.set(tick.ball_x, y, tick.ball_z);
    camera.position.lerp(new THREE.Vector3(tick.ball_x * 0.25, 22, 60), 0.08);
    camera.lookAt(tick.ball_x, 0.5, tick.ball_z);
  });

  return (
    <>
      <color attach="background" args={["#0c141c"]} />
      <fog attach="fog" args={["#0c141c", 120, 400]} />
      <Environment preset="night" background={false} />
      <ambientLight intensity={0.4} />
      <directionalLight castShadow position={[28, 48, 22]} intensity={2.2} color="#f0f4f8" />
      <Floodlights withShafts={false} />
      <Stadium snowAmount={0.05} />
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

  useEffect(() => {
    api
      .flaggedMatches()
      .then((rows) => {
        setFlagged(rows);
        if (rows[0]?.match_id) setMatchId(rows[0].match_id);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!matchId) return;
    setPlaying(false);
    setIndex(0);
    api
      .replay(matchId)
      .then((r) => {
        setTicks(r.ticks || []);
        setTeleports(r.teleports || 0);
        setSource(r.source || "silver.match_ticks");
      })
      .catch((e) => setError(String(e.message || e)));
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
    <main>
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

      {error && <p className="error">{error}</p>}

      <div className="row">
        <div className="card" style={{ flex: 2 }}>
          <div className="pitch-wrap pitch-3d broadcast-pitch">
            <Canvas shadows camera={{ position: [0, 22, 60], fov: 28 }} style={{ height: 480 }}>
              {ticks.length > 0 && <ReplayScene ticks={ticks} index={index} />}
            </Canvas>
          </div>
          <div style={{ marginTop: 12 }}>
            <input
              type="range"
              min={0}
              max={Math.max(0, ticks.length - 1)}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
              style={{ width: "100%" }}
            />
            <div
              style={{
                position: "relative",
                height: 8,
                marginTop: 4,
                background: "#1a2228",
                borderRadius: 4,
              }}
            >
              {teleportMarks.map((i) => (
                <span
                  key={i}
                  title={`Teleport @ tick ${ticks[i]?.tick_ms}ms`}
                  style={{
                    position: "absolute",
                    left: `${(i / Math.max(1, ticks.length - 1)) * 100}%`,
                    top: 0,
                    width: 3,
                    height: 8,
                    background: "#ff6b4a",
                  }}
                />
              ))}
            </div>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : "Play"}
              </button>
              <span className="muted">
                {current
                  ? `${current.minute.toFixed(1)}' · ${current.home_goals}–${current.away_goals} · ${
                      current.is_teleport ? "TELEPORT" : current.phase
                    }`
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
            {flagged.map((m) => (
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
            {!flagged.length && <li className="muted">No flagged matches yet — run make seed.</li>}
          </ul>
        </aside>
      </div>
    </main>
  );
}
