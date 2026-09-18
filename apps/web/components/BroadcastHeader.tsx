"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Lower-third style page header — team-color block + condensed label + LIVE pill. */
export function BroadcastHeader({
  kicker = "SP-1.12",
  title,
  lineage,
}: {
  kicker?: string;
  title: string;
  lineage?: string;
}) {
  const [live, setLive] = useState(false);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const check = () => {
      api
        .pipeline()
        .then((p) => {
          if (!p.last_tick_at) {
            setLive(false);
            return;
          }
          const age = Date.now() - new Date(p.last_tick_at).getTime();
          setLive(age < 120_000);
        })
        .catch(() => setLive(false));
    };
    check();
    const id = window.setInterval(check, 10000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="lower-third">
      <div className="lower-third-bar" aria-hidden />
      <div className="lower-third-body">
        <div>
          <p className="kicker">{kicker}</p>
          <h1 className="ops-title">{title}</h1>
          {lineage && <p className="lineage-strip">{lineage}</p>}
        </div>
        <div className="lower-third-meta">
          <span className={`live-pill ${live ? "on" : "off"}`}>{live ? "LIVE" : "IDLE"}</span>
          <span className="wall-clock">{clock}</span>
        </div>
      </div>
    </header>
  );
}

export function MinuteStamp({ minute }: { minute: number | string }) {
  const m = typeof minute === "number" ? minute : parseInt(String(minute), 10) || 0;
  return <span className="minute-stamp">{String(m).padStart(2, "0")}′</span>;
}
