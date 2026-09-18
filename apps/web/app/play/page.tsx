"use client";

import { useEffect, useState } from "react";
import { MatchGame } from "@/components/MatchGame";
import { BroadcastHeader } from "@/components/BroadcastHeader";
import { api, type Profile } from "@/lib/api";

const KEY = "snowpitch_player";

export default function PlayPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  const boot = async () => {
    setError("");
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        try {
          const me = await api.me(saved);
          setProfile(me);
          return;
        } catch {
          localStorage.removeItem(KEY);
        }
      }
      const created = await api.bootstrap();
      localStorage.setItem(KEY, created.player_id);
      setProfile(created);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  };

  useEffect(() => {
    boot();
  }, []);

  if (error) {
    return (
      <main className="match-page page-error">
        <p className="kicker">SP-1 · MATCH</p>
        <h1>Warehouse offline</h1>
        <p className="error">{error}</p>
        <p className="lede">From the project root: make seed && make api</p>
        <button type="button" className="btn" onClick={boot}>
          Retry
        </button>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="match-page">
        <BroadcastHeader kicker="SP-1 · MATCH" title="Arcade half" lineage="Signing to FC Rime…" />
        <div className="pitch-wrap pitch-3d broadcast-pitch">
          <div className="pitch-loading">Snowflake profile lookup · hang tight (~10–15s)</div>
        </div>
      </main>
    );
  }
  return (
    <main className="match-page">
      <BroadcastHeader
        kicker="SP-1 · MATCH"
        title="Arcade half"
        lineage="WASD · Shift sprint · Q switch · LMB shoot · E pass · F lob"
      />
      <MatchGame profile={profile} />
    </main>
  );
}
