from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import duckdb

from simulator.config import DB_PATH, EVENTS_PATH, PATCH_TS
from warehouse.base import Warehouse
from warehouse.dbt_runner import run as dbt_run

_LOCK = threading.Lock()


def connect(db_path: str | None = None) -> duckdb.DuckDBPyConnection:
    Path(db_path or DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(db_path or DB_PATH)


def load_bronze(events_path: str | None = None, db_path: str | None = None) -> str:
    """Load raw events into bronze. Silver/gold are owned exclusively by dbt."""
    events = Path(events_path or EVENTS_PATH)
    db = db_path or DB_PATH
    if not events.exists():
        raise FileNotFoundError(events)

    con = connect(db)
    con.execute("DROP TABLE IF EXISTS bronze_events")
    con.execute(
        """
        CREATE TABLE bronze_events AS
        SELECT
            event_id,
            event_type,
            CAST(ts AS TIMESTAMP) AS ts,
            player_id,
            CAST(to_json(payload) AS VARCHAR) AS payload
        FROM read_json_auto(?, format := 'newline_delimited')
        """,
        [str(events)],
    )
    con.execute("CREATE TABLE IF NOT EXISTS live_config (k VARCHAR, v VARCHAR)")
    con.execute("DELETE FROM live_config")
    con.execute("INSERT INTO live_config VALUES ('momentum', 'true'), ('pack_nerf', 'true')")
    con.execute("DROP TABLE IF EXISTS bronze_match_ticks")
    ticks_path = Path("data/match_ticks.jsonl")
    if ticks_path.exists():
        con.execute(
            """
            CREATE TABLE bronze_match_ticks AS
            SELECT
                match_id,
                CAST(tick_ms AS INTEGER) AS tick_ms,
                CAST(minute AS DOUBLE) AS minute,
                CAST(ball_x AS DOUBLE) AS ball_x,
                CAST(ball_y AS DOUBLE) AS ball_y,
                CAST(ball_z AS DOUBLE) AS ball_z,
                possession,
                CAST(home_goals AS INTEGER) AS home_goals,
                CAST(away_goals AS INTEGER) AS away_goals,
                phase,
                CAST(momentum_on AS BOOLEAN) AS momentum_on,
                patch,
                player_id,
                CAST(ts AS TIMESTAMP) AS ts
            FROM read_json_auto(?, format := 'newline_delimited')
            """,
            [str(ticks_path)],
        )
    else:
        con.execute(
            """
            CREATE TABLE bronze_match_ticks (
                match_id VARCHAR,
                tick_ms INTEGER,
                minute DOUBLE,
                ball_x DOUBLE,
                ball_y DOUBLE,
                ball_z DOUBLE,
                possession VARCHAR,
                home_goals INTEGER,
                away_goals INTEGER,
                phase VARCHAR,
                momentum_on BOOLEAN,
                patch VARCHAR,
                player_id VARCHAR,
                ts TIMESTAMP
            )
            """
        )
    con.close()
    return db


def load_bronze_parquet(parquet_dir: str | Path, db_path: str | None = None) -> str:
    """Load chunked Parquet events (large scale profile) into bronze."""
    directory = Path(parquet_dir)
    glob = str(directory / "events_*.parquet")
    db = db_path or DB_PATH
    con = connect(db)
    con.execute("DROP TABLE IF EXISTS bronze_events")
    con.execute(
        f"""
        CREATE TABLE bronze_events AS
        SELECT
            event_id,
            event_type,
            CAST(ts AS TIMESTAMP) AS ts,
            player_id,
            payload
        FROM read_parquet('{glob}')
        """
    )
    con.execute("CREATE TABLE IF NOT EXISTS live_config (k VARCHAR, v VARCHAR)")
    con.execute("DELETE FROM live_config")
    con.execute("INSERT INTO live_config VALUES ('momentum', 'true'), ('pack_nerf', 'true')")
    con.execute("DROP TABLE IF EXISTS bronze_match_ticks")
    ticks_path = Path("data/match_ticks.jsonl")
    if ticks_path.exists():
        con.execute(
            """
            CREATE TABLE bronze_match_ticks AS
            SELECT
                match_id,
                CAST(tick_ms AS INTEGER) AS tick_ms,
                CAST(minute AS DOUBLE) AS minute,
                CAST(ball_x AS DOUBLE) AS ball_x,
                CAST(ball_y AS DOUBLE) AS ball_y,
                CAST(ball_z AS DOUBLE) AS ball_z,
                possession,
                CAST(home_goals AS INTEGER) AS home_goals,
                CAST(away_goals AS INTEGER) AS away_goals,
                phase,
                CAST(momentum_on AS BOOLEAN) AS momentum_on,
                patch,
                player_id,
                CAST(ts AS TIMESTAMP) AS ts
            FROM read_json_auto(?, format := 'newline_delimited')
            """,
            [str(ticks_path)],
        )
    else:
        con.execute(
            """
            CREATE TABLE bronze_match_ticks (
                match_id VARCHAR, tick_ms INTEGER, minute DOUBLE,
                ball_x DOUBLE, ball_y DOUBLE, ball_z DOUBLE,
                possession VARCHAR, home_goals INTEGER, away_goals INTEGER,
                phase VARCHAR, momentum_on BOOLEAN, patch VARCHAR,
                player_id VARCHAR, ts TIMESTAMP
            )
            """
        )
    con.close()
    return db


def rebuild(events_path: str | None = None, db_path: str | None = None) -> str:
    """Load bronze then run dbt so silver/gold match the models in dbt/."""
    db = load_bronze(events_path=events_path, db_path=db_path)
    dbt_run("build", target="duckdb")
    return db


def _ingest_event(con: duckdb.DuckDBPyConnection, row: dict) -> None:
    payload = row["payload"]
    if not isinstance(payload, str):
        payload = json.dumps(payload)
    ts = str(row["ts"]).replace("Z", "")
    con.execute(
        """
        INSERT INTO bronze_events (event_id, event_type, ts, player_id, payload)
        VALUES (?, ?, CAST(? AS TIMESTAMP), ?, ?)
        """,
        [row["event_id"], row["event_type"], ts, row["player_id"], payload],
    )


def _jsonify_rows(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        item = {}
        for k, v in r.items():
            key = str(k).lower()
            if hasattr(v, "isoformat"):
                item[key] = v.isoformat()
            else:
                item[key] = v
        out.append(item)
    return out


class DuckDBWarehouse:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or DB_PATH

    def backend_name(self) -> str:
        return "duckdb"

    def ready(self) -> bool:
        return Path(self.db_path).exists()

    def _connect(self) -> duckdb.DuckDBPyConnection:
        if not self.ready():
            raise FileNotFoundError(
                f"Warehouse is empty at {self.db_path}. Run `make seed` first."
            )
        return connect(self.db_path)

    def _fetchall(self, sql: str, params: list | None = None) -> list[dict]:
        with _LOCK:
            con = self._connect()
            cur = con.execute(sql, params or [])
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            con.close()
        return _jsonify_rows(rows)

    def _fetchone(self, sql: str, params: list | None = None) -> dict | None:
        rows = self._fetchall(sql, params)
        return rows[0] if rows else None

    def me(self, player_id: str) -> dict[str, Any] | None:
        row = self._fetchone(
            """
            SELECT player_id,
                   json_extract_string(payload, '$.display_name') AS display_name,
                   CAST(json_extract(payload, '$.ovr') AS INTEGER) AS ovr,
                   CAST(json_extract(payload, '$.coins') AS INTEGER) AS coins,
                   json_extract(payload, '$.squad') AS squad
            FROM bronze_events
            WHERE event_type = 'player_snapshot' AND player_id = ?
            ORDER BY ts DESC
            LIMIT 1
            """,
            [player_id],
        )
        if not row:
            return None
        squad = row.get("squad")
        if isinstance(squad, str):
            squad = json.loads(squad)
        row["squad"] = squad
        row["coins"] = row.get("coins") or 7500
        return row

    def opponent(self) -> dict[str, Any] | None:
        return self._fetchone(
            """
            SELECT player_id, display_name, ovr, nation, spend_tier
            FROM silver_players
            WHERE bot = TRUE
            ORDER BY RANDOM()
            LIMIT 1
            """
        )

    def get_config(self) -> dict[str, bool]:
        rows = self._fetchall("SELECT k, v FROM live_config")
        data = {r["k"]: r["v"] == "true" for r in rows}
        data.setdefault("momentum", True)
        data.setdefault("pack_nerf", True)
        return data

    def set_config(
        self, *, momentum: bool | None = None, pack_nerf: bool | None = None
    ) -> dict[str, bool]:
        with _LOCK:
            con = self._connect()
            if momentum is not None:
                con.execute("DELETE FROM live_config WHERE k = 'momentum'")
                con.execute(
                    "INSERT INTO live_config VALUES ('momentum', ?)",
                    ["true" if momentum else "false"],
                )
            if pack_nerf is not None:
                con.execute("DELETE FROM live_config WHERE k = 'pack_nerf'")
                con.execute(
                    "INSERT INTO live_config VALUES ('pack_nerf', ?)",
                    ["true" if pack_nerf else "false"],
                )
            con.close()
        return self.get_config()

    def ingest_events(self, rows: list[dict[str, Any]]) -> None:
        # Marts are dbt views on DuckDB, so an insert into bronze is enough.
        with _LOCK:
            con = self._connect()
            for row in rows:
                payload = row["payload"]
                _ingest_event(
                    con,
                    {
                        **row,
                        "payload": json.dumps(payload)
                        if not isinstance(payload, str)
                        else payload,
                    },
                )
            con.close()

    def refresh_marts(self) -> None:
        dbt_run("build", target="duckdb")

    def listings(self, limit: int = 12) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT trade_id AS listing_id, seller_id, rarity, price, ts
            FROM silver_trades
            ORDER BY ts DESC
            LIMIT ?
            """,
            [limit],
        )

    def summary(self) -> dict[str, Any]:
        matches = self._fetchone("SELECT COUNT(*) AS n FROM silver_matches") or {"n": 0}
        packs = self._fetchone("SELECT COUNT(*) AS n FROM silver_packs") or {"n": 0}
        trades = self._fetchone("SELECT COUNT(*) AS n FROM silver_trades") or {"n": 0}
        alerts = self.alerts()
        return {
            "matches": int(matches.get("n") or 0),
            "packs": int(packs.get("n") or 0),
            "trades": int(trades.get("n") or 0),
            "alerts": len(alerts),
            "patch_ts": PATCH_TS.isoformat(),
            "backend": self.backend_name(),
        }

    def fairness(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_match_fairness ORDER BY patch")

    def packs(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_pack_odds ORDER BY patch")

    def market(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_market_health ORDER BY patch")

    def spend(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_spend ORDER BY win_rate DESC")

    def alerts(self) -> list[dict[str, Any]]:
        rows = self._fetchall("SELECT * FROM gold_integrity_alerts")
        states = self.alert_states()
        for row in rows:
            st = states.get(str(row.get("alert_id")), {})
            row["state"] = st.get("state") or "open"
            row["state_actor"] = st.get("actor")
            row["state_note"] = st.get("note")
            row["state_updated_at"] = st.get("updated_at")
        return rows

    def _ensure_alert_state(self, con) -> None:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS ops_alert_state (
                alert_id VARCHAR PRIMARY KEY,
                state VARCHAR,
                actor VARCHAR,
                note VARCHAR,
                updated_at TIMESTAMP
            )
            """
        )

    def alert_states(self) -> dict[str, dict[str, Any]]:
        try:
            with _LOCK:
                con = self._connect()
                self._ensure_alert_state(con)
                cur = con.execute("SELECT alert_id, state, actor, note, updated_at FROM ops_alert_state")
                cols = [c[0] for c in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
                con.close()
            out: dict[str, dict[str, Any]] = {}
            for r in _jsonify_rows(rows):
                out[str(r["alert_id"])] = r
            return out
        except Exception:
            return {}

    def set_alert_state(
        self,
        alert_id: str,
        state: str,
        *,
        actor: str = "ops",
        note: str = "",
    ) -> dict[str, Any]:
        allowed = {"open", "ack", "resolved"}
        if state not in allowed:
            raise ValueError(f"state must be one of {allowed}")
        with _LOCK:
            con = self._connect()
            self._ensure_alert_state(con)
            con.execute("DELETE FROM ops_alert_state WHERE alert_id = ?", [alert_id])
            con.execute(
                """
                INSERT INTO ops_alert_state (alert_id, state, actor, note, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [alert_id, state, actor, note],
            )
            con.close()
        return {"alert_id": alert_id, "state": state, "actor": actor, "note": note}

    def alert_evidence(self, alert_id: str) -> dict[str, Any]:
        from warehouse.dbt_runner import alert_evidence as _evidence

        alerts = {str(a.get("alert_id")): a for a in self.alerts()}
        row = alerts.get(alert_id)
        if not row:
            return {"ok": False, "alert_id": alert_id, "message": "Alert not firing"}
        source = str(row.get("source_model") or "")
        ev = _evidence(source)
        return {
            "ok": True,
            "alert_id": alert_id,
            "severity": row.get("severity"),
            "title": row.get("title"),
            "detail": row.get("detail"),
            "metric": row.get("metric"),
            "threshold": row.get("threshold"),
            "source_model": source,
            "detected_at": row.get("detected_at"),
            "state": row.get("state", "open"),
            **ev,
        }

    def daily(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_daily ORDER BY day")

    def integrity_tests(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_integrity_tests ORDER BY test_id")

    def ingest_ticks(
        self,
        match_id: str,
        ticks: list[dict[str, Any]],
        *,
        player_id: str = "",
        patch: str = "1.12-whiteout",
    ) -> int:
        if not ticks:
            return 0
        with _LOCK:
            con = self._connect()
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS bronze_match_ticks (
                    match_id VARCHAR,
                    tick_ms INTEGER,
                    minute DOUBLE,
                    ball_x DOUBLE,
                    ball_y DOUBLE,
                    ball_z DOUBLE,
                    possession VARCHAR,
                    home_goals INTEGER,
                    away_goals INTEGER,
                    phase VARCHAR,
                    momentum_on BOOLEAN,
                    chrome_assist BOOLEAN,
                    world_scale DOUBLE,
                    patch VARCHAR,
                    player_id VARCHAR,
                    ts TIMESTAMP
                )
                """
            )
            rows = [
                (
                    match_id,
                    int(t.get("tick_ms", 0)),
                    float(t.get("minute", 0)),
                    float(t.get("ball_x", 0)),
                    float(t.get("ball_y", 0)),
                    float(t.get("ball_z", 0)),
                    str(t.get("possession", "home")),
                    int(t.get("home_goals", 0)),
                    int(t.get("away_goals", 0)),
                    str(t.get("phase", "run")),
                    bool(t.get("momentum_on", True)),
                    bool(t.get("chrome_assist", False)),
                    float(t.get("world_scale", 1.0)),
                    patch,
                    player_id,
                )
                for t in ticks
            ]
            # Best-effort schema upgrades for live flags.
            try:
                con.execute(
                    "ALTER TABLE bronze_match_ticks ADD COLUMN IF NOT EXISTS chrome_assist BOOLEAN DEFAULT FALSE"
                )
            except Exception:
                pass
            try:
                con.execute(
                    "ALTER TABLE bronze_match_ticks ADD COLUMN IF NOT EXISTS world_scale DOUBLE DEFAULT 1.0"
                )
            except Exception:
                pass
            try:
                con.executemany(
                    """
                    INSERT INTO bronze_match_ticks (
                        match_id, tick_ms, minute, ball_x, ball_y, ball_z,
                        possession, home_goals, away_goals, phase, momentum_on,
                        chrome_assist, world_scale, patch, player_id, ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    rows,
                )
            except Exception:
                # Older bronze tables — drop optional columns from the insert.
                slim = [
                    (
                        r[0],
                        r[1],
                        r[2],
                        r[3],
                        r[4],
                        r[5],
                        r[6],
                        r[7],
                        r[8],
                        r[9],
                        r[10],
                        r[13],
                        r[14],
                    )
                    for r in rows
                ]
                con.executemany(
                    """
                    INSERT INTO bronze_match_ticks (
                        match_id, tick_ms, minute, ball_x, ball_y, ball_z,
                        possession, home_goals, away_goals, phase, momentum_on,
                        patch, player_id, ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    slim,
                )
            con.close()
        return len(rows)

    def replay(self, match_id: str) -> dict[str, Any]:
        source = "silver.match_ticks"
        try:
            ticks = self._fetchall(
                """
                SELECT tick_ms, minute, ball_x, ball_y, ball_z, possession,
                       home_goals, away_goals, phase,
                       COALESCE(is_teleport, FALSE) AS is_teleport,
                       ball_speed,
                       1.0 AS world_scale
                FROM silver_match_ticks
                WHERE match_id = ?
                ORDER BY tick_ms
                """,
                [match_id],
            )
        except Exception:
            source = "bronze.match_ticks"
            try:
                ticks = self._fetchall(
                    """
                    SELECT tick_ms, minute, ball_x, ball_y, ball_z, possession,
                           home_goals, away_goals, phase,
                           FALSE AS is_teleport,
                           NULL AS ball_speed,
                           COALESCE(world_scale, 1.0) AS world_scale
                    FROM bronze_match_ticks
                    WHERE match_id = ?
                    ORDER BY tick_ms
                    """,
                    [match_id],
                )
            except Exception:
                ticks = self._fetchall(
                    """
                    SELECT tick_ms, minute, ball_x, ball_y, ball_z, possession,
                           home_goals, away_goals, phase,
                           FALSE AS is_teleport,
                           NULL AS ball_speed,
                           1.0 AS world_scale
                    FROM bronze_match_ticks
                    WHERE match_id = ?
                    ORDER BY tick_ms
                    """,
                    [match_id],
                )
        # Legacy ticks (pre-metric 42×28): if the whole match never leaves
        # the old playable box, scale every coord up to metres.
        legacy_scale = 105.0 / 42.0
        max_extent = 0.0
        for t in ticks:
            max_extent = max(
                max_extent,
                abs(float(t.get("ball_x") or 0)),
                abs(float(t.get("ball_z") or 0)),
            )
        is_legacy = max_extent > 0.5 and max_extent < 22
        scaled: list[dict[str, Any]] = []
        for t in ticks:
            row = dict(t)
            if is_legacy:
                row["ball_x"] = float(row.get("ball_x") or 0) * legacy_scale
                by = float(row.get("ball_y") or 0.11)
                row["ball_y"] = 0.11 if by < 1.0 else by * legacy_scale
                row["ball_z"] = float(row.get("ball_z") or 0) * legacy_scale
                row["world_scale"] = legacy_scale
                if row.get("ball_speed") is not None:
                    row["ball_speed"] = float(row["ball_speed"]) * legacy_scale
            else:
                row["world_scale"] = float(row.get("world_scale") or 1.0)
            scaled.append(row)
        teleports = sum(1 for t in scaled if t.get("is_teleport"))
        return {
            "match_id": match_id,
            "ticks": scaled,
            "teleports": teleports,
            "source": source,
        }

    def flagged_matches(self, limit: int = 20) -> list[dict[str, Any]]:
        try:
            return self._fetchall(
                f"""
                SELECT match_id, teleports, max_speed
                FROM gold_tick_integrity
                WHERE teleports > 0
                ORDER BY teleports DESC, max_speed DESC
                LIMIT {int(limit)}
                """
            )
        except Exception:
            return []

    def pipeline(self) -> dict[str, Any]:
        quality = self.quality()
        bronze_ticks = 0
        last_tick_at = None
        try:
            row = self._fetchone(
                """
                SELECT COUNT(*) AS n, MAX(ts) AS last_ts
                FROM bronze_match_ticks
                """
            ) or {}
            bronze_ticks = int(row.get("n") or 0)
            last_tick_at = row.get("last_ts")
            if hasattr(last_tick_at, "isoformat"):
                last_tick_at = last_tick_at.isoformat()
        except Exception:
            pass
        return {
            "ok": self.ready(),
            "backend": self.backend_name(),
            "location": self.db_path,
            "bronze_table": "bronze.match_ticks",
            "bronze_ticks": bronze_ticks,
            "last_tick_at": last_tick_at,
            "quality": quality,
        }

    def quality(self) -> dict[str, Any]:
        """Surface the last dbt run results for the LiveOps quality panel."""
        from warehouse.dbt_runner import last_run_summary

        return last_run_summary()


_: Warehouse = DuckDBWarehouse()  # type: ignore[assignment]
