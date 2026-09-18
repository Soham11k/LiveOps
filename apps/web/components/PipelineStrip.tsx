"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Pipeline = {
  ok: boolean;
  backend: string;
  location: string;
  bronze_table: string;
  bronze_ticks: number;
  last_tick_at: string | null;
  quality: {
    ok: boolean;
    message: string;
    passed: number;
    warned: number;
    failed: number;
    models: number;
    elapsed_seconds: number | null;
    generated_at?: string;
  };
};

function shortLoc(loc: string) {
  if (loc.length <= 48) return loc;
  const parts = loc.split(/[/\\]/);
  return parts.slice(-2).join("/");
}

export function PipelineStrip() {
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lastFlush, setLastFlush] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .pipeline()
      .then((p) => {
        setPipe(p);
        setErr("");
      })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [load]);

  // Client-only: localStorage differs from SSR and caused hydration errors
  useEffect(() => {
    const tick = () => {
      try {
        const raw = localStorage.getItem("snowpitch_last_tick_flush");
        if (!raw) {
          setLastFlush(null);
          return;
        }
        const ago = Math.round((Date.now() - Number(raw)) / 1000);
        setLastFlush(ago < 120 ? `${ago}s ago` : null);
      } catch {
        setLastFlush(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  async function refresh() {
    setBusy(true);
    setErr("");
    try {
      await api.refreshMarts();
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  const q = pipe?.quality;

  return (
    <footer className="pipeline-strip">
      <div className="pipeline-main">
        <span className="pipeline-primary">
          {pipe ? (
            <>
              <code>{pipe.backend}</code> · <code>{shortLoc(pipe.location)}</code>
            </>
          ) : (
            <code>pipeline…</code>
          )}
        </span>
        <span>
          <code>{pipe?.bronze_table || "bronze.match_ticks"}</code>{" "}
          {pipe ? pipe.bronze_ticks.toLocaleString() : "—"}
          {lastFlush ? ` · flush ${lastFlush}` : ""}
        </span>
        <span className="pipeline-dbt">
          dbt · {q ? `${q.passed}P/${q.warned}W/${q.failed}F` : "—"}
          {q?.elapsed_seconds != null ? ` · ${q.elapsed_seconds}s` : ""}
        </span>
      </div>
      <div className="pipeline-actions">
        {err && <span className="error" style={{ fontSize: 11 }}>{err}</span>}
        <button type="button" className="btn ghost pipeline-btn" disabled={busy} onClick={refresh}>
          {busy ? "Refreshing…" : "Refresh marts"}
        </button>
      </div>
    </footer>
  );
}
