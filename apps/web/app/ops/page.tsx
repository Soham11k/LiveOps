"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type Alert } from "@/lib/api";

function pct(n: number | string | undefined) {
  const v = Number(n || 0);
  return `${(v * 100).toFixed(1)}%`;
}

type Quality = {
  ok: boolean;
  message: string;
  passed: number;
  warned: number;
  failed: number;
  models: number;
  elapsed_seconds: number | null;
  generated_at?: string;
  freshness?: { generated_at?: string; sources?: number } | null;
};

type IntegrityTest = {
  test_id: string;
  title: string;
  baseline_rate: number;
  patched_rate: number;
  effect_size: number;
  z_stat: number;
  p_value: number;
  wilson_low: number;
  wilson_high: number;
};

export default function OpsPage() {
  const [summary, setSummary] = useState<{ matches: number; packs: number; trades: number; alerts: number } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fairness, setFairness] = useState<Record<string, number | string>[]>([]);
  const [packs, setPacks] = useState<Record<string, number | string>[]>([]);
  const [market, setMarket] = useState<Record<string, number | string>[]>([]);
  const [spend, setSpend] = useState<{ spend_tier: string; win_rate: number; appearances: number }[]>([]);
  const [daily, setDaily] = useState<{ day: string; matches: number }[]>([]);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [tests, setTests] = useState<IntegrityTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState({ momentum: true, pack_nerf: true });
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, a, f, p, m, sp, c, d, q, t] = await Promise.all([
        api.summary(),
        api.alerts(),
        api.fairness(),
        api.packs(),
        api.market(),
        api.spend(),
        api.config(),
        api.daily(),
        api.quality(),
        api.integrityTests(),
      ]);
      setSummary(s);
      setAlerts(a);
      setFairness(f);
      setPacks(p);
      setMarket(m);
      setSpend(sp);
      setCfg(c);
      setDaily(d);
      setQuality(q);
      setTests(t);
      setLoading(false);
    } catch (e) {
      setError(String((e as Error).message || e));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const fairData = fairness.map((row) => ({
    patch: String(row.patch),
    late: Number(row.late_comeback_rate || 0) * 100,
  }));
  const packData = packs.map((row) => ({
    patch: String(row.patch),
    observed: Number(row.observed_rare_rate || 0) * 100,
    advertised: Number(row.advertised_rare_rate || 0) * 100,
  }));
  const spendData = spend.map((row) => ({
    tier: row.spend_tier,
    win: Number(row.win_rate) * 100,
  }));
  const dailyData = daily.map((row) => ({
    day: String(row.day).slice(5, 10),
    matches: Number(row.matches),
  }));

  return (
    <main>
      <p className="kicker">LiveOps integrity</p>
      <h1>Did Whiteout break the league?</h1>
      <p className="lede">
        Gold marts over the simulated season plus your live matches. The warehouse is supposed to raise three
        alerts. If any are missing, the project failed.
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
          <h2>Data quality</h2>
          {quality ? (
            <>
              <p className="muted">{quality.message}</p>
              <div className="statgrid" style={{ marginTop: 12 }}>
                <div className="stat">
                  <span>Passed</span>
                  <b>{quality.passed}</b>
                </div>
                <div className="stat">
                  <span>Warned</span>
                  <b>{quality.warned}</b>
                </div>
                <div className="stat">
                  <span>Failed</span>
                  <b>{quality.failed}</b>
                </div>
                <div className="stat">
                  <span>Models</span>
                  <b>{quality.models}</b>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 12 }}>
                Last dbt build {quality.elapsed_seconds ?? "—"}s
                {quality.generated_at ? ` · ${quality.generated_at}` : ""}
              </p>
            </>
          ) : (
            <p className="muted">Run `make dbt` to populate quality.</p>
          )}
          <div className="toggle" style={{ marginTop: 16 }}>
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
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={fairData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(231,239,228,0.12)" />
                <XAxis dataKey="patch" stroke="#6d7c72" fontSize={12} />
                <YAxis stroke="#6d7c72" fontSize={12} unit="%" />
                <Tooltip />
                <Bar dataKey="late" name="Late conversion %" fill="#d45b4a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2>Pack rares vs advertised</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={packData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(231,239,228,0.12)" />
                <XAxis dataKey="patch" stroke="#6d7c72" fontSize={12} />
                <YAxis stroke="#6d7c72" fontSize={12} unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="observed" name="Observed %" fill="#e09a3e" radius={[6, 6, 0, 0]} />
                <Bar dataKey="advertised" name="Advertised %" fill="#d4b06a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="split" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>Daily match volume</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(231,239,228,0.12)" />
                <XAxis dataKey="day" stroke="#6d7c72" fontSize={12} />
                <YAxis stroke="#6d7c72" fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="matches" stroke="#7eb89a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2>Win rate by spend tier</h2>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(231,239,228,0.12)" />
                <XAxis dataKey="tier" stroke="#6d7c72" fontSize={12} />
                <YAxis stroke="#6d7c72" fontSize={12} unit="%" />
                <Tooltip />
                <Bar dataKey="win" name="Win %" fill="#7eb89a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="split" style={{ marginTop: 18 }}>
        <section className="card">
          <h2>Statistical tests</h2>
          {tests.length === 0 && <p className="muted">No integrity_tests rows yet.</p>}
          {tests.map((t) => (
            <article key={t.test_id} className="alert high" style={{ marginBottom: 10 }}>
              <strong>{t.title}</strong>
              <p>
                {pct(t.baseline_rate)} → {pct(t.patched_rate)} · Δ {pct(t.effect_size)} · z={" "}
                {Number(t.z_stat).toFixed(2)} · p≈{Number(t.p_value).toExponential(1)} · Wilson [
                {pct(t.wilson_low)}, {pct(t.wilson_high)}]
              </p>
            </article>
          ))}
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
