from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from simulator.config import ADVERTISED_RARE_RATE, PATCH_TS
from warehouse.base import Warehouse
from warehouse.dbt_runner import run as dbt_run

_LOCK = threading.Lock()
SQL_DIR = Path(__file__).resolve().parents[1] / "transform" / "snowflake"


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ[key] = value


def snowflake_env_ready() -> bool:
    _load_dotenv()
    return bool(os.getenv("SNOWFLAKE_ACCOUNT") and os.getenv("SNOWFLAKE_USER") and os.getenv("SNOWFLAKE_PASSWORD"))


def connect_snowflake():
    import snowflake.connector

    _load_dotenv()
    if not snowflake_env_ready():
        raise RuntimeError(
            "Snowflake credentials missing. Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD."
        )
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        role=os.getenv("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
        database=os.getenv("SNOWFLAKE_DATABASE", "SNOWPITCH"),
        schema=os.getenv("SNOWFLAKE_SCHEMA", "BRONZE"),
    )


def _jsonify_rows(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        item = {}
        for k, v in r.items():
            key = str(k).lower()
            if hasattr(v, "isoformat"):
                item[key] = v.isoformat()
            elif isinstance(v, str) and key == "squad":
                try:
                    item[key] = json.loads(v)
                except json.JSONDecodeError:
                    item[key] = v
            else:
                item[key] = v
        out.append(item)
    return out


def run_sql_file(cur, path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    for stmt in text.split(";"):
        cleaned = "\n".join(
            line for line in stmt.splitlines() if line.strip() and not line.strip().startswith("--")
        ).strip()
        if cleaned:
            cur.execute(cleaned)


class SnowflakeWarehouse:
    def backend_name(self) -> str:
        return "snowflake"

    def ready(self) -> bool:
        if not snowflake_env_ready():
            return False
        try:
            with _LOCK:
                con = connect_snowflake()
                cur = con.cursor()
                cur.execute("SELECT COUNT(*) FROM SNOWPITCH.BRONZE.RAW_EVENTS")
                cur.fetchone()
                con.close()
            return True
        except Exception:
            return False

    def _fetchall(self, sql: str, params: tuple | list | None = None) -> list[dict]:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute(sql, params or ())
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            con.close()
        return _jsonify_rows(rows)

    def _fetchone(self, sql: str, params: tuple | list | None = None) -> dict | None:
        rows = self._fetchall(sql, params)
        return rows[0] if rows else None

    def _execute(self, sql: str, params: tuple | list | None = None) -> None:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute(sql, params or ())
            con.close()

    def me(self, player_id: str) -> dict[str, Any] | None:
        row = self._fetchone(
            """
            SELECT PLAYER_ID AS player_id,
                   PAYLOAD:display_name::STRING AS display_name,
                   PAYLOAD:ovr::NUMBER AS ovr,
                   PAYLOAD:coins::NUMBER AS coins,
                   PAYLOAD:squad::STRING AS squad
            FROM SNOWPITCH.BRONZE.RAW_EVENTS
            WHERE EVENT_TYPE = 'player_snapshot' AND PLAYER_ID = %s
            ORDER BY TS DESC
            LIMIT 1
            """,
            (player_id,),
        )
        if not row:
            return None
        squad = row.get("squad")
        if isinstance(squad, str):
            try:
                squad = json.loads(squad)
            except json.JSONDecodeError:
                pass
        row["squad"] = squad
        row["coins"] = row.get("coins") or 7500
        return row

    def opponent(self) -> dict[str, Any] | None:
        return self._fetchone(
            """
            SELECT PLAYER_ID AS player_id,
                   DISPLAY_NAME AS display_name,
                   OVR AS ovr,
                   NATION AS nation,
                   SPEND_TIER AS spend_tier
            FROM SNOWPITCH.SILVER.PLAYERS
            WHERE BOT = TRUE
            ORDER BY RANDOM()
            LIMIT 1
            """
        )

    def get_config(self) -> dict[str, bool]:
        rows = self._fetchall("SELECT K AS k, V AS v FROM SNOWPITCH.BRONZE.LIVE_CONFIG")
        data = {r["k"]: r["v"] == "true" for r in rows}
        data.setdefault("momentum", True)
        data.setdefault("pack_nerf", True)
        return data

    def set_config(
        self, *, momentum: bool | None = None, pack_nerf: bool | None = None
    ) -> dict[str, bool]:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            if momentum is not None:
                cur.execute("DELETE FROM SNOWPITCH.BRONZE.LIVE_CONFIG WHERE K = 'momentum'")
                cur.execute(
                    "INSERT INTO SNOWPITCH.BRONZE.LIVE_CONFIG (K, V) VALUES (%s, %s)",
                    ("momentum", "true" if momentum else "false"),
                )
            if pack_nerf is not None:
                cur.execute("DELETE FROM SNOWPITCH.BRONZE.LIVE_CONFIG WHERE K = 'pack_nerf'")
                cur.execute(
                    "INSERT INTO SNOWPITCH.BRONZE.LIVE_CONFIG (K, V) VALUES (%s, %s)",
                    ("pack_nerf", "true" if pack_nerf else "false"),
                )
            con.close()
        return self.get_config()

    def ingest_events(self, rows: list[dict[str, Any]]) -> None:
        # Bronze only. Gold is refreshed by the Snowflake Task / Airflow / make dbt.
        # Never rebuild marts on every live match write.
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            for row in rows:
                payload = row["payload"]
                if not isinstance(payload, str):
                    payload = json.dumps(payload)
                ts = str(row["ts"]).replace("Z", "")
                cur.execute(
                    """
                    INSERT INTO SNOWPITCH.BRONZE.RAW_EVENTS
                        (EVENT_ID, EVENT_TYPE, TS, PLAYER_ID, PAYLOAD)
                    SELECT %s, %s, TO_TIMESTAMP_NTZ(%s), %s, PARSE_JSON(%s)
                    """,
                    (row["event_id"], row["event_type"], ts, row["player_id"], payload),
                )
            # Mark marts stale so the Task / Airflow / refresh_marts can pick up.
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS SNOWPITCH.BRONZE.MARTS_STALE (
                    STALE BOOLEAN,
                    MARKED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
                """
            )
            cur.execute("DELETE FROM SNOWPITCH.BRONZE.MARTS_STALE")
            cur.execute(
                "INSERT INTO SNOWPITCH.BRONZE.MARTS_STALE (STALE, MARKED_AT) VALUES (TRUE, CURRENT_TIMESTAMP())"
            )
            con.close()

    def refresh_marts(self) -> None:
        dbt_run("build", target="snowflake")
        try:
            self._execute(
                """
                UPDATE SNOWPITCH.BRONZE.MARTS_STALE
                SET STALE = FALSE, MARKED_AT = CURRENT_TIMESTAMP()
                """
            )
        except Exception:
            pass

    def listings(self, limit: int = 12) -> list[dict[str, Any]]:
        return self._fetchall(
            f"""
            SELECT TRADE_ID AS listing_id,
                   SELLER_ID AS seller_id,
                   RARITY AS rarity,
                   PRICE AS price,
                   TS AS ts
            FROM SNOWPITCH.SILVER.TRADES
            ORDER BY TS DESC
            LIMIT {int(limit)}
            """
        )

    def summary(self) -> dict[str, Any]:
        matches = self._fetchone("SELECT COUNT(*) AS n FROM SNOWPITCH.SILVER.MATCHES") or {"n": 0}
        packs = self._fetchone("SELECT COUNT(*) AS n FROM SNOWPITCH.SILVER.PACKS") or {"n": 0}
        trades = self._fetchone("SELECT COUNT(*) AS n FROM SNOWPITCH.SILVER.TRADES") or {"n": 0}
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
        return self._fetchall(
            """
            SELECT PATCH AS patch,
                   TRAILING_LATE_CHANCES AS trailing_late_chances,
                   TRAILING_LATE_GOALS AS trailing_late_goals,
                   LATE_COMEBACK_RATE AS late_comeback_rate,
                   WHALE_WIN_RATE AS whale_win_rate,
                   F2P_WIN_RATE AS f2p_win_rate
            FROM SNOWPITCH.GOLD.MATCH_FAIRNESS
            ORDER BY PATCH
            """
        )

    def packs(self) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT PATCH AS patch,
                   PACKS AS packs,
                   OBSERVED_RARE_RATE AS observed_rare_rate,
                   ADVERTISED_RARE_RATE AS advertised_rare_rate,
                   DRIFT AS drift,
                   CHI_SQUARE_STAT AS chi_square_stat
            FROM SNOWPITCH.GOLD.PACK_ODDS
            ORDER BY PATCH
            """
        )

    def market(self) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT PATCH AS patch,
                   TRADES AS trades,
                   MEDIAN_PRICE AS median_price,
                   AVG_PRICE AS avg_price,
                   SUSPECTED_WASH AS suspected_wash,
                   WASH_ACCOUNTS AS wash_accounts
            FROM SNOWPITCH.GOLD.MARKET_HEALTH
            ORDER BY PATCH
            """
        )

    def spend(self) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT SPEND_TIER AS spend_tier,
                   APPEARANCES AS appearances,
                   WINS AS wins,
                   WIN_RATE AS win_rate
            FROM SNOWPITCH.GOLD.SPEND
            ORDER BY WIN_RATE DESC
            """
        )

    def alerts(self) -> list[dict[str, Any]]:
        rows = self._fetchall(
            """
            SELECT ALERT_ID AS alert_id,
                   SEVERITY AS severity,
                   TITLE AS title,
                   DETAIL AS detail,
                   METRIC AS metric,
                   THRESHOLD AS threshold,
                   SOURCE_MODEL AS source_model,
                   DETECTED_AT AS detected_at
            FROM SNOWPITCH.GOLD.INTEGRITY_ALERTS
            """
        )
        states = self.alert_states()
        for row in rows:
            st = states.get(str(row.get("alert_id")), {})
            row["state"] = st.get("state") or "open"
            row["state_actor"] = st.get("actor")
            row["state_note"] = st.get("note")
            row["state_updated_at"] = st.get("updated_at")
        return rows

    def alert_states(self) -> dict[str, dict[str, Any]]:
        try:
            rows = self._fetchall(
                """
                SELECT ALERT_ID AS alert_id, STATE AS state, ACTOR AS actor,
                       NOTE AS note, UPDATED_AT AS updated_at
                FROM SNOWPITCH.OPS.ALERT_STATE
                """
            )
            return {str(r["alert_id"]): r for r in rows}
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
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute("CREATE SCHEMA IF NOT EXISTS SNOWPITCH.OPS")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS SNOWPITCH.OPS.ALERT_STATE (
                    ALERT_ID STRING, STATE STRING, ACTOR STRING, NOTE STRING,
                    UPDATED_AT TIMESTAMP_NTZ
                )
                """
            )
            cur.execute("DELETE FROM SNOWPITCH.OPS.ALERT_STATE WHERE ALERT_ID = %s", (alert_id,))
            cur.execute(
                """
                INSERT INTO SNOWPITCH.OPS.ALERT_STATE (ALERT_ID, STATE, ACTOR, NOTE, UPDATED_AT)
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP())
                """,
                (alert_id, state, actor, note),
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
        return self._fetchall(
            """
            SELECT DAY AS day, MATCHES AS matches, MATCH_ROWS AS match_rows
            FROM SNOWPITCH.GOLD.DAILY
            ORDER BY DAY
            """
        )

    def integrity_tests(self) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT TEST_ID AS test_id,
                   TITLE AS title,
                   BASELINE_RATE AS baseline_rate,
                   PATCHED_RATE AS patched_rate,
                   EFFECT_SIZE AS effect_size,
                   Z_STAT AS z_stat,
                   P_VALUE AS p_value,
                   WILSON_LOW AS wilson_low,
                   WILSON_HIGH AS wilson_high
            FROM SNOWPITCH.GOLD.INTEGRITY_TESTS
            ORDER BY TEST_ID
            """
        )

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
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS SNOWPITCH.BRONZE.MATCH_TICKS (
                    MATCH_ID STRING, TICK_MS NUMBER, MINUTE FLOAT,
                    BALL_X FLOAT, BALL_Y FLOAT, BALL_Z FLOAT,
                    POSSESSION STRING, HOME_GOALS NUMBER, AWAY_GOALS NUMBER,
                    PHASE STRING, MOMENTUM_ON BOOLEAN, CHROME_ASSIST BOOLEAN,
                    WORLD_SCALE FLOAT, PATCH STRING, PLAYER_ID STRING, TS TIMESTAMP_NTZ
                )
                """
            )
            try:
                cur.execute(
                    "ALTER TABLE SNOWPITCH.BRONZE.MATCH_TICKS ADD COLUMN IF NOT EXISTS CHROME_ASSIST BOOLEAN DEFAULT FALSE"
                )
            except Exception:
                pass
            try:
                cur.execute(
                    "ALTER TABLE SNOWPITCH.BRONZE.MATCH_TICKS ADD COLUMN IF NOT EXISTS WORLD_SCALE FLOAT DEFAULT 1.0"
                )
            except Exception:
                pass
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
            cur.executemany(
                """
                INSERT INTO SNOWPITCH.BRONZE.MATCH_TICKS (
                    MATCH_ID, TICK_MS, MINUTE, BALL_X, BALL_Y, BALL_Z,
                    POSSESSION, HOME_GOALS, AWAY_GOALS, PHASE, MOMENTUM_ON,
                    CHROME_ASSIST, WORLD_SCALE, PATCH, PLAYER_ID, TS
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP())
                """,
                rows,
            )
            con.close()
        return len(rows)

    def replay(self, match_id: str) -> dict[str, Any]:
        source = "SNOWPITCH.SILVER.MATCH_TICKS"
        try:
            ticks = self._fetchall(
                """
                SELECT TICK_MS AS tick_ms, MINUTE AS minute,
                       BALL_X AS ball_x, BALL_Y AS ball_y, BALL_Z AS ball_z,
                       POSSESSION AS possession, HOME_GOALS AS home_goals,
                       AWAY_GOALS AS away_goals, PHASE AS phase,
                       IS_TELEPORT AS is_teleport, BALL_SPEED AS ball_speed,
                       1.0 AS world_scale
                FROM SNOWPITCH.SILVER.MATCH_TICKS
                WHERE MATCH_ID = %s
                ORDER BY TICK_MS
                """,
                (match_id,),
            )
        except Exception:
            source = "SNOWPITCH.BRONZE.MATCH_TICKS"
            ticks = self._fetchall(
                """
                SELECT TICK_MS AS tick_ms, MINUTE AS minute,
                       BALL_X AS ball_x, BALL_Y AS ball_y, BALL_Z AS ball_z,
                       POSSESSION AS possession, HOME_GOALS AS home_goals,
                       AWAY_GOALS AS away_goals, PHASE AS phase,
                       FALSE AS is_teleport, NULL AS ball_speed,
                       COALESCE(WORLD_SCALE, 1.0) AS world_scale
                FROM SNOWPITCH.BRONZE.MATCH_TICKS
                WHERE MATCH_ID = %s
                ORDER BY TICK_MS
                """,
                (match_id,),
            )
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
                SELECT MATCH_ID AS match_id,
                       TELEPORTS AS teleports,
                       MAX_SPEED AS max_speed
                FROM SNOWPITCH.GOLD.TICK_INTEGRITY
                WHERE TELEPORTS > 0
                ORDER BY TELEPORTS DESC, MAX_SPEED DESC
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
                "SELECT COUNT(*) AS n, MAX(TS) AS last_ts FROM SNOWPITCH.BRONZE.MATCH_TICKS"
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
            "location": "SNOWPITCH.BRONZE",
            "bronze_table": "SNOWPITCH.BRONZE.MATCH_TICKS",
            "bronze_ticks": bronze_ticks,
            "last_tick_at": last_tick_at,
            "quality": quality,
        }

    def quality(self) -> dict[str, Any]:
        from warehouse.dbt_runner import last_run_summary

        return last_run_summary()


_: Warehouse = SnowflakeWarehouse()  # type: ignore[assignment]
_ = ADVERTISED_RARE_RATE
