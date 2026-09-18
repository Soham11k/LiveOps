"use client";

import { useEffect, useState } from "react";
import { MatchGame } from "@/components/MatchGame";
import { BroadcastHeader } from "@/components/BroadcastHeader";
import { api, type Profile } from "@/lib/api";

const KEY = "snowpitch_player";

export default function PlayPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const boot = async () => {
      try {
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
    boot();
  }, []);

  if (error) {
    return (
      <main>
        <h1>Warehouse offline</h1>
        <p className="error">{error}</p>
        <p className="lede">From the project root: make seed && make api</p>
      </main>
    );
  }
  if (!profile) {
    return (
      <main>
        <p className="muted">Signing you to FC Rime…</p>
        <p className="lede" style={{ marginTop: 8 }}>
          Snowflake profile lookup can take ~10–15s on first hit — hang tight.
        </p>
      </main>
    );
  }
  return (
    <main className="match-page">
      <BroadcastHeader kicker="SP-1 · MATCH" title="Arcade half" lineage="WASD · Shift sprint · Q switch · LMB shoot · E pass · F lob" />
      <MatchGame profile={profile} />
    </main>
  );
}
