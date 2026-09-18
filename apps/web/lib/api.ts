export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type SquadPlayer = {
  pos: string;
  name: string;
  ovr: number;
  nation: string;
};

export type Profile = {
  player_id: string;
  display_name: string;
  ovr: number;
  coins: number;
  squad: SquadPlayer[];
};

export type Opponent = {
  player_id: string;
  display_name: string;
  ovr: number;
  nation: string;
  spend_tier: string;
};

export type Alert = {
  alert_id: string;
  severity: string;
  title: string;
  detail?: string;
  metric: number;
  threshold?: number;
  source_model?: string;
  detected_at?: string;
  state?: string;
  state_actor?: string;
  state_note?: string;
  state_updated_at?: string;
};

export type AlertEvidence = {
  ok: boolean;
  alert_id: string;
  message?: string;
  severity?: string;
  title?: string;
  detail?: string;
  metric?: number;
  threshold?: number;
  source_model?: string;
  detected_at?: string;
  state?: string;
  compiled_sql?: string | null;
  upstream_refs?: string[];
  unique_id?: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean }>("/health"),
  bootstrap: (display_name?: string) =>
    req<Profile>("/me/bootstrap", {
      method: "POST",
      body: JSON.stringify({ display_name }),
    }),
  me: (id: string) => req<Profile>(`/me/${id}`),
  opponent: () => req<Opponent>("/play/opponent"),
  config: () => req<{ momentum: boolean; pack_nerf: boolean }>("/ops/config"),
  setConfig: (body: { momentum?: boolean; pack_nerf?: boolean }) =>
    req("/ops/config", { method: "POST", body: JSON.stringify(body) }),
  submitMatch: (body: {
    player_id: string;
    home_goals: number;
    away_goals: number;
    opponent_id: string;
    opponent_ovr: number;
    chances: {
      minute: number;
      timing: number;
      scored: boolean;
      trailing_before: boolean;
      late: boolean;
      attacking_home: boolean;
    }[];
  }) => req<{ match_id: string; reward_pack: boolean }>("/play/match", { method: "POST", body: JSON.stringify(body) }),
  openPack: (player_id: string) =>
    req<{ pack_id: string; rarity: string; ovr: number; name: string; is_rare: boolean; advertised_rare_rate: number }>(
      "/play/pack",
      { method: "POST", body: JSON.stringify({ player_id }) }
    ),
  listings: () =>
    req<{ listing_id: string; name: string; rarity: string; price: number; ovr: number }[]>("/market/listings"),
  buy: (player_id: string, listing_id: string) =>
    req("/market/buy", { method: "POST", body: JSON.stringify({ player_id, listing_id }) }),
  summary: () => req<{ matches: number; packs: number; trades: number; alerts: number; patch_ts: string }>("/ops/summary"),
  fairness: () => req<Record<string, number | string>[]>("/ops/fairness"),
  packs: () => req<Record<string, number | string>[]>("/ops/packs"),
  market: () => req<Record<string, number | string>[]>("/ops/market"),
  alerts: () => req<Alert[]>("/ops/alerts"),
  setAlertState: (alert_id: string, body: { state: string; actor?: string; note?: string }) =>
    req<{ alert_id: string; state: string }>("/ops/alerts/" + encodeURIComponent(alert_id) + "/state", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alertEvidence: (alert_id: string) =>
    req<AlertEvidence>("/ops/alerts/" + encodeURIComponent(alert_id) + "/evidence"),
  daily: () => req<{ day: string; matches: number }[]>("/ops/daily"),
  spend: () => req<{ spend_tier: string; appearances: number; wins: number; win_rate: number }[]>("/ops/spend"),
  quality: () =>
    req<{
      ok: boolean;
      message: string;
      passed: number;
      warned: number;
      failed: number;
      models: number;
      elapsed_seconds: number | null;
      generated_at?: string;
      freshness?: { generated_at?: string; sources?: number } | null;
    }>("/ops/quality"),
  integrityTests: () =>
    req<
      {
        test_id: string;
        title: string;
        baseline_rate: number;
        patched_rate: number;
        effect_size: number;
        z_stat: number;
        p_value: number;
        wilson_low: number;
        wilson_high: number;
      }[]
    >("/ops/integrity-tests"),
  sendTicks: (
    match_id: string,
    ticks: {
      tick_ms: number;
      minute: number;
      ball_x: number;
      ball_y: number;
      ball_z: number;
      possession: "home" | "away";
      home_goals: number;
      away_goals: number;
      phase: string;
      momentum_on: boolean;
      chrome_assist?: boolean;
      world_scale?: number;
    }[]
  ) =>
    req<{ ok: boolean; n: number }>("/play/ticks", {
      method: "POST",
      body: JSON.stringify({ match_id, ticks }),
    }),
  replay: (match_id: string) =>
    req<{
      match_id: string;
      ticks: {
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
        world_scale?: number;
        ball_speed?: number;
      }[];
      teleports: number;
      source?: string;
    }>(`/ops/replay/${encodeURIComponent(match_id)}`),
  flaggedMatches: () =>
    req<{ match_id: string; teleports: number; max_speed: number }[]>("/ops/flagged-matches"),
  pipeline: () =>
    req<{
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
    }>("/ops/pipeline"),
  refreshMarts: () =>
    req<{ ok: boolean; backend: string }>("/ops/refresh", { method: "POST" }),
};
