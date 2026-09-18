"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import { api, type Alert, type AlertEvidence } from "@/lib/api";
import { BroadcastHeader } from "@/components/BroadcastHeader";

function fmtMetric(alertId: string, n: number | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (alertId === "momentum" || alertId === "pack_odds") return `${(v * 100).toFixed(1)}%`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtWhen(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return String(iso);
  }
}

type Filter = "open" | "ack" | "resolved" | "all";

export function OpsDesk() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fairness, setFairness] = useState<Record<string, number | string>[]>([]);
  const [packs, setPacks] = useState<Record<string, number | string>[]>([]);
  const [quality, setQuality] = useState<{
    ok: boolean;
    message: string;
    passed: number;
    warned: number;
    failed: number;
    models: number;
    elapsed_seconds: number | null;
    generated_at?: string;
  } | null>(null);
  const [cfg, setCfg] = useState({ momentum: true, pack_nerf: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chromeAssist, setChromeAssist] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<AlertEvidence | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [a, f, p, c, q] = await Promise.all([
        api.alerts(),
        api.fairness(),
        api.packs(),
        api.config(),
        api.quality(),
      ]);
      setAlerts(a);
      setFairness(f);
      setPacks(p);
      setCfg(c);
      setQuality(q);
      setLoading(false);
    } catch (e) {
      setError(String((e as Error).message || e));
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    try {
      setChromeAssist(localStorage.getItem("snowpitch_chrome_assist") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setEvidence(null);
      return;
    }
    api.alertEvidence(selected).then(setEvidence).catch(() => setEvidence(null));
  }, [selected]);

  const chromeRow: Alert | null = chromeAssist
    ? {
        alert_id: "client_chrome_assist",
        severity: "high",
        title: "Match UI widened late finishes for trailing home",
        detail: "Sticky Shoot, scoreboard gaslight, tab title lie after 70′ with momentum armed.",
        metric: 1,
        threshold: 0,
        source_model: "client",
        detected_at: new Date().toISOString(),
        state: "open",
      }
    : null;

  const allRows = useMemo(() => {
    const rows = [...alerts];
    if (chromeRow) rows.unshift(chromeRow);
    return rows;
  }, [alerts, chromeAssist]);

  const filtered = useMemo(() => {
    if (filter === "all") return allRows;
    return allRows.filter((a) => (a.state || "open") === filter);
  }, [allRows, filter]);

  const fairSpark = fairness.map((row) => ({
    patch: String(row.patch).replace("1.12-whiteout", "1.12"),
    v: Number(row.late_comeback_rate || 0) * 100,
  }));
  const packSpark = packs.map((row) => ({
    patch: String(row.patch).replace("1.12-whiteout", "1.12"),
    v: Number(row.observed_rare_rate || 0) * 100,
  }));

  async function setState(alertId: string, state: string) {
    if (alertId === "client_chrome_assist") {
      if (state === "resolved" || state === "ack") {
        try {
          localStorage.removeItem("snowpitch_chrome_assist");
        } catch {
          /* ignore */
        }
        setChromeAssist(false);
      }
      return;
    }
    setBusy(true);
    try {
      await api.setAlertState(alertId, { state, actor: "ops" });
      await load();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ops-desk">
      <BroadcastHeader
        kicker="SP-1.12 · LIVEOPS · GOLD"
        title="Incident queue"
        lineage="Game → API → bronze → dbt → gold → alerts"
      />
      {error && <p className="error">{error}</p>}

      <div className="incident-filters">
        {(["open", "ack", "resolved", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-chip ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length} / {allRows.length}
        </span>
      </div>

      <div className="ops-split">
        <section className="telemetry-frame">
          <div className="incident-table-wrap">
            <table className="incident-table">
              <thead>
                <tr>
                  <th />
                  <th>ID</th>
                  <th>Title</th>
                  <th>Observed</th>
                  <th>Threshold</th>
                  <th>First seen</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="muted">
                      Reading gold marts…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No incidents in this filter. Seed the warehouse or clear filters.
                    </td>
                  </tr>
                )}
                {filtered.map((a) => (
                  <tr
                    key={a.alert_id}
                    data-selected={selected === a.alert_id ? "true" : "false"}
                    onClick={() => setSelected(a.alert_id)}
                  >
                    <td>
                      <span className={`sev-bar ${a.severity}`} title={a.severity} />
                    </td>
                    <td>
                      <code className="alert-id">{a.alert_id}</code>
                    </td>
                    <td className="alert-title">{a.title}</td>
                    <td className="num">{fmtMetric(a.alert_id, a.metric)}</td>
                    <td className="num">{fmtMetric(a.alert_id, a.threshold)}</td>
                    <td className="num">{fmtWhen(a.detected_at)}</td>
                    <td>
                      <span className={`state-chip ${(a.state || "open").toLowerCase()}`}>
                        {a.state || "open"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="spark-row">
            <div className="spark-card">
              <p className="kicker">Late conversion %</p>
              <div style={{ width: "100%", height: 72 }}>
                <ResponsiveContainer>
                  <BarChart data={fairSpark}>
                    <Bar dataKey="v" fill="var(--bad)" />
                    <XAxis dataKey="patch" tick={{ fill: "#5c6570", fontSize: 10 }} axisLine={false} tickLine={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="spark-card">
              <p className="kicker">Observed rare %</p>
              <div style={{ width: "100%", height: 72 }}>
                <ResponsiveContainer>
                  <LineChart data={packSpark}>
                    <Line type="monotone" dataKey="v" stroke="var(--warn)" strokeWidth={2} dot={false} />
                    <XAxis dataKey="patch" tick={{ fill: "#5c6570", fontSize: 10 }} axisLine={false} tickLine={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="spark-card quality-mini">
              <p className="kicker">dbt quality</p>
              {quality ? (
                <p className="quality-line">
                  <b>{quality.passed}</b>P / <b>{quality.warned}</b>W / <b>{quality.failed}</b>F ·{" "}
                  {quality.models} models
                </p>
              ) : (
                <p className="muted">Run make dbt</p>
              )}
              <div className="toggle" style={{ marginTop: 8, padding: "6px 0" }}>
                <span>Momentum</span>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    const next = await api.setConfig({ momentum: !cfg.momentum });
                    setCfg(next as typeof cfg);
                  }}
                >
                  {cfg.momentum ? "On" : "Off"}
                </button>
              </div>
              <div className="toggle" style={{ padding: "6px 0" }}>
                <span>Pack nerf</span>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    const next = await api.setConfig({ pack_nerf: !cfg.pack_nerf });
                    setCfg(next as typeof cfg);
                  }}
                >
                  {cfg.pack_nerf ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="telemetry-frame evidence-pane">
          {!selected && <p className="muted">Select an incident for compiled SQL evidence.</p>}
          {selected && evidence && (
            <>
              <div className="evidence-head">
                <code className="alert-id">{evidence.alert_id}</code>
                <span className={`sev-label ${evidence.severity}`}>{evidence.severity}</span>
              </div>
              <h2 className="evidence-title">{evidence.title}</h2>
              <p className="lede" style={{ fontSize: 12 }}>
                {evidence.detail}
              </p>
              <div className="score-pair">
                <div>
                  <span>Observed</span>
                  <b>{fmtMetric(evidence.alert_id, evidence.metric)}</b>
                </div>
                <div>
                  <span>Threshold</span>
                  <b>{fmtMetric(evidence.alert_id, evidence.threshold)}</b>
                </div>
                <div>
                  <span>Source</span>
                  <b>
                    <code>{evidence.source_model}</code>
                  </b>
                </div>
              </div>
              {evidence.upstream_refs && evidence.upstream_refs.length > 0 && (
                <p className="muted" style={{ marginTop: 10 }}>
                  refs: {evidence.upstream_refs.join(" → ")}
                </p>
              )}
              <div className="evidence-actions">
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setState(selected, "ack")}>
                  Ack
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setState(selected, "resolved")}>
                  Resolve
                </button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setState(selected, "open")}>
                  Reopen
                </button>
                {selected === "speed_hack" && (
                  <a className="btn ghost" href="/ops/replay">
                    Replay →
                  </a>
                )}
              </div>
              <p className="kicker" style={{ marginTop: 16 }}>
                Compiled model
              </p>
              <pre className="sql-pane">{evidence.compiled_sql || evidence.message || "—"}</pre>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
