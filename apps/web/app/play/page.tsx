"use client";

import { useEffect, useState } from "react";
import { MatchGame } from "@/components/MatchGame";
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
  if (!profile) return <p className="muted">Signing you to FC Rime…</p>;
  return (
    <main>
      <p className="kicker">Weekend League</p>
      <h1>Whiteout night</h1>
      <MatchGame profile={profile} />
    </main>
  );
}
