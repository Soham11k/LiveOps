"use client";

import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { PITCH, HOME_NUMBERS, AWAY_NUMBERS, CONTROLLED_IDX } from "@/lib/pitch";
import type { SceneState } from "@/components/MatchGame3D";

type Props = {
  stateRef: MutableRefObject<SceneState>;
  displayHome: number;
  home: number;
  away: number;
  minute: number;
  opponentName: string;
  matchId: string;
  feedCorrected: boolean;
  chromeAssist: boolean;
  tickCount: number;
  homePlayerName?: string;
};

function formatClock(minute: number): string {
  const m = Math.min(90, Math.floor(minute));
  const frac = minute - Math.floor(minute);
  const sec = Math.min(59, Math.floor(frac * 60));
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Bottom-centre SVG radar — 22 dots + ball from live scene state. */
function Radar({ stateRef }: { stateRef: MutableRefObject<SceneState> }) {
  const [dots, setDots] = useState<{ hx: number[]; hz: number[]; ax: number[]; az: number[]; bx: number; bz: number }>({
    hx: [],
    hz: [],
    ax: [],
    az: [],
    bx: 0,
    bz: 0,
  });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = stateRef.current;
      const home = s.homePositions || [];
      const away = s.awayPositions || [];
      setDots({
        hx: home.map((p) => p.x),
        hz: home.map((p) => p.z),
        ax: away.map((p) => p.x),
        az: away.map((p) => p.z),
        bx: s.ball.x,
        bz: s.ball.z,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stateRef]);

  const W = 160;
  const H = 104;
  const toU = (x: number) => ((x / PITCH.length) + 0.5) * W;
  const toV = (z: number) => ((z / PITCH.width) + 0.5) * H;

  return (
    <svg className="match-radar" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label="Tactical radar">
      <rect x={1} y={1} width={W - 2} height={H - 2} fill="rgba(20,40,28,0.72)" stroke="rgba(200,220,200,0.35)" strokeWidth={1} />
      <line x1={W / 2} y1={2} x2={W / 2} y2={H - 2} stroke="rgba(200,220,200,0.25)" strokeWidth={1} />
      <circle cx={W / 2} cy={H / 2} r={12} fill="none" stroke="rgba(200,220,200,0.25)" strokeWidth={1} />
      {dots.hx.map((x, i) => (
        <circle key={`h${i}`} cx={toU(x)} cy={toV(dots.hz[i])} r={i === CONTROLLED_IDX ? 3.2 : 2.2} fill="#d4b06a" />
      ))}
      {dots.ax.map((x, i) => (
        <circle key={`a${i}`} cx={toU(x)} cy={toV(dots.az[i])} r={2.2} fill="#7eb0d8" />
      ))}
      <circle cx={toU(dots.bx)} cy={toV(dots.bz)} r={2.6} fill="#f4f7f2" stroke="#111" strokeWidth={0.6} />
    </svg>
  );
}

export function MatchHUD({
  stateRef,
  displayHome,
  home,
  away,
  minute,
  opponentName,
  matchId,
  feedCorrected,
  chromeAssist,
  tickCount,
  homePlayerName = "FC Rime",
}: Props) {
  const clock = formatClock(minute);
  const phantom = displayHome !== home;
  const [stamina, setStamina] = useState(1);
  const [ctrlNum, setCtrlNum] = useState(HOME_NUMBERS[CONTROLLED_IDX]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = stateRef.current;
      setStamina(s.stamina ?? 1);
      setCtrlNum(HOME_NUMBERS[s.controlledIdx] ?? HOME_NUMBERS[CONTROLLED_IDX]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stateRef]);

  const staminaPct = `${Math.round(Math.max(0, Math.min(1, stamina)) * 100)}%`;

  return (
    <div className="match-hud">
      <div className={`scorebug ${feedCorrected ? "feed-corrected" : ""}`}>
        <div className="scorebug-badge" title="Snowpitch">SP</div>
        <div className="scorebug-teams">
          <span className="sb-abbr">RIM</span>
          <span className={`sb-score ${phantom ? "phantom-score" : ""}`}>
            {displayHome}
          </span>
          <span className="sb-dash">-</span>
          <span className="sb-score">{away}</span>
          <span className="sb-abbr away">{opponentName.slice(0, 3).toUpperCase() || "AWY"}</span>
        </div>
        <div className="scorebug-clock">{clock}</div>
        <div className="scorebug-live" aria-hidden>
          LIVE
        </div>
      </div>

      <div className="match-hud-meta">
        <span className="match-id-chip">{matchId}</span>
        <span className="tick-counter" title="10 Hz samples flushed to bronze">
          {tickCount} → bronze
        </span>
        {feedCorrected && <span className="feed-caption">feed corrected</span>}
        {chromeAssist && (
          <span className="rigged-chip" title="Client chrome widened late finishes for trailing home">
            chrome_assist · armed
          </span>
        )}
      </div>

      <div className="team-panel home-panel">
        <div className="crest home-crest" />
        <div className="team-panel-body">
          <div className="team-panel-name">{homePlayerName}</div>
          <div className="stamina-bar" title={`Stamina ${staminaPct}`}>
            <i style={{ width: staminaPct }} />
          </div>
          <div className="squad-num">{ctrlNum}</div>
        </div>
      </div>

      <div className="radar-wrap">
        <Radar stateRef={stateRef} />
      </div>

      <div className="team-panel away-panel">
        <div className="team-panel-body right">
          <div className="team-panel-name">{opponentName || "Away"}</div>
          <div className="stamina-bar away">
            <i style={{ width: "100%" }} />
          </div>
          <div className="squad-num">{AWAY_NUMBERS[9]}</div>
        </div>
        <div className="crest away-crest" />
      </div>
    </div>
  );
}
