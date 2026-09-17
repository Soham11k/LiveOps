"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "@/lib/api";

function pct(n: number | string | undefined) {
  const v = Number(n || 0);
  return `${(v * 100).toFixed(1)}%`;
}

export default function OpsPage() {
  const [summary, setSummary] = useState<{ matches: number; packs: number; trades: number; alerts: number } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fairness, setFairness] = useState<Record<string, number | string>[]>([]);
  const [packs, setPacks] = useState<Record<string, number | string>[]>([]);
  const [market, setMarket] = useState<Record<string, number | string>[]>([]);
  const [spend, setSpend] = useState<{ spend_tier: string; win_rate: number; appearances: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState({ momentum: true, pack_nerf: true });
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, a, f, p, m, sp, c] = await Promise.all([
        api.summary(),
        api.alerts(),
        api.fairness(),
        api.packs(),
        api.market(),
        api.spend(),
        api.config(),
      ]);
      setSummary(s);
      setAlerts(a);
      setFairness(f);
      setPacks(p);
      setMarket(m);
      setSpend(sp);
      setCfg(c);
      setLoading(false);
    } catch (e) {
      setError(String((e as Error).message || e));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const maxWin = Math.max(...spend.map((s) => s.win_rate), 0.01);

  return (
    <main>
      <p className="kicker">LiveOps integrity</p>
      <h1>Did Whiteout break the league?</h1>
      <p className="lede">
        Gold marts over the simulated season plus your live matches. The warehouse is supposed to
        raise three alerts. If any are missing, the project failed.
      </p>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="statgrid" style={{ margin: "24px 0" }}>
          <div className="stat">
            <span>Matches</span>
            <b>{summary.matches.toLocaleString()}</b>
          </div>
          <div className="stat">
            <span>Packs</span>
            <b>{summary.packs.toLocaleString()}</b>
          </div>
          <div className="stat">
            <span>Trades</span>
            <b>{summary.trades.toLocaleString()}</b>
          </div>
          <div className="stat">
            <span>Alerts</span>
            <b>{summary.alerts}</b>
          </div>
        </div>
      )}

      <div className="row">
        <section className="card">
          <h2>Integrity alerts</h2>
          {loading && <p className="muted">Reading gold marts…</p>}
          {!loading && alerts.length === 0 && <p className="muted">No alerts. Seed the warehouse.</p>}
          {alerts.map((a) => (
            <article key={a.alert_id} className={`alert ${a.severity}`}>
              <strong>{a.title}</strong>
              <p>{a.detail || a.alert_id}</p>
            </article>
          ))}
        </section>
        <section className="card">
          <h2>Live toggles</h2>
          <p className="muted">These change what your next match and pack write into bronze.</p>
          <div className="toggle">
            <span>Momentum scripting</span>
            <button
              className="btn ghost"
              onClick={async () => {
                const next = await api.setConfig({ momentum: !cfg.momentum });
                setCfg(next as typeof cfg);
              }}
            >
              {cfg.momentum ? "On" : "Off"}
            </button>
          </div>
          <div className="toggle">
            <span>Pack odds nerf</span>
            <button
              className="btn ghost"
              onClick={async () => {
                const next = await api.setConfig({ pack_nerf: !cfg.pack_nerf });
                setCfg(next as typeof cfg);
              }}
            >
              {cfg.pack_nerf ? "On" : "Off"}
            </button>
          </div>
        </section>
      </div>

      <div className="split" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>Late comeback rate</h2>
          <div className="bar-chart">
            {fairness.map((row) => (
              <div key={String(row.patch)}>
                <i
                  style={{
                    height: `${Math.min(100, Number(row.late_comeback_rate) * 160)}%`,
                    background: String(row.patch).includes("1.12") ? "var(--bad)" : "var(--ok)",
                  }}
                />
                <span>{row.patch}</span>
                <span>{pct(row.late_comeback_rate)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Pack rares vs 12% advertised</h2>
          <div className="bar-chart">
            {packs.map((row) => (
              <div key={String(row.patch)}>
                <i
                  style={{
                    height: `${Math.min(100, Number(row.observed_rare_rate) * 400)}%`,
                    background: String(row.patch).includes("1.12") ? "var(--warn)" : "var(--gold)",
                  }}
                />
                <span>{row.patch}</span>
                <span>{pct(row.observed_rare_rate)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="split" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>Win rate by spend tier</h2>
          <div className="bar-chart">
            {spend.map((row) => (
              <div key={row.spend_tier}>
                <i style={{ height: `${(row.win_rate / maxWin) * 100}%` }} />
                <span>{row.spend_tier}</span>
                <span>{pct(row.win_rate)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Transfer market</h2>
          {market.map((row) => (
            <p key={String(row.patch)}>
              <strong>{row.patch}</strong> · median {Number(row.median_price).toFixed(0)} coins · suspected wash{" "}
              {String(row.suspected_wash)}
            </p>
          ))}
        </section>
      </div>
    </main>
  );
}
