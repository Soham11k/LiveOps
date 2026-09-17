from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Optional

from simulator.config import ADVERTISED_RARE_RATE, PATCH_TS
from warehouse.base import Warehouse

_LOCK = threading.Lock()
SQL_DIR = Path(__file__).resolve().parents[1] / "transform" / "snowflake"


def snowflake_env_ready() -> bool:
    return bool(os.getenv("SNOWFLAKE_ACCOUNT") and os.getenv("SNOWFLAKE_USER") and os.getenv("SNOWFLAKE_PASSWORD"))


def connect_snowflake():
    import snowflake.connector

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
    # Split on semicolons; skip empty / comment-only chunks.
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

    def _fetchall(self, sql: str, params: Optional[tuple | list] = None) -> list[dict]:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute(sql, params or ())
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            con.close()
        return _jsonify_rows(rows)

    def _fetchone(self, sql: str, params: Optional[tuple | list] = None) -> Optional[dict]:
        rows = self._fetchall(sql, params)
        return rows[0] if rows else None

    def _execute(self, sql: str, params: Optional[tuple | list] = None) -> None:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            cur.execute(sql, params or ())
            con.close()

    def me(self, player_id: str) -> Optional[dict[str, Any]]:
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

    def opponent(self) -> Optional[dict[str, Any]]:
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
        self, *, momentum: Optional[bool] = None, pack_nerf: Optional[bool] = None
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
            # Refresh gold marts after live writes (trial scale).
            run_sql_file(cur, SQL_DIR / "03_gold.sql")
            con.close()

    def refresh_marts(self) -> None:
        with _LOCK:
            con = connect_snowflake()
            cur = con.cursor()
            run_sql_file(cur, SQL_DIR / "02_silver.sql")
            run_sql_file(cur, SQL_DIR / "03_gold.sql")
            con.close()

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
        return self._fetchall(
            """
            SELECT ALERT_ID AS alert_id,
                   SEVERITY AS severity,
                   TITLE AS title,
                   DETAIL AS detail,
                   METRIC AS metric
            FROM SNOWPITCH.GOLD.INTEGRITY_ALERTS
            """
        )

    def daily(self) -> list[dict[str, Any]]:
        return self._fetchall(
            """
            SELECT DAY AS day, MATCHES AS matches, MATCH_ROWS AS match_rows
            FROM SNOWPITCH.GOLD.DAILY
            ORDER BY DAY
            """
        )


_: Warehouse = SnowflakeWarehouse()  # type: ignore[assignment]
_ = ADVERTISED_RARE_RATE
