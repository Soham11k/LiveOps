from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Optional

import duckdb

from simulator.config import ADVERTISED_RARE_RATE, DB_PATH, EVENTS_PATH, PATCH_TS
from warehouse.base import Warehouse

_LOCK = threading.Lock()


def connect(db_path: str | None = None) -> duckdb.DuckDBPyConnection:
    Path(db_path or DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(db_path or DB_PATH)


def rebuild(events_path: str | None = None, db_path: str | None = None) -> str:
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
    _silver(con)
    _gold(con)
    con.execute("CREATE TABLE IF NOT EXISTS live_config (k VARCHAR, v VARCHAR)")
    con.execute("DELETE FROM live_config")
    con.execute("INSERT INTO live_config VALUES ('momentum', 'true'), ('pack_nerf', 'true')")
    con.close()
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


def _silver(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("DROP VIEW IF EXISTS silver_players")
    con.execute("DROP VIEW IF EXISTS silver_matches")
    con.execute("DROP VIEW IF EXISTS silver_chances")
    con.execute("DROP VIEW IF EXISTS silver_goals")
    con.execute("DROP VIEW IF EXISTS silver_packs")
    con.execute("DROP VIEW IF EXISTS silver_trades")

    con.execute(
        """
        CREATE VIEW silver_players AS
        SELECT
            player_id,
            json_extract_string(payload, '$.display_name') AS display_name,
            json_extract_string(payload, '$.nation') AS nation,
            CAST(json_extract(payload, '$.ovr') AS INTEGER) AS ovr,
            json_extract_string(payload, '$.spend_tier') AS spend_tier,
            CAST(json_extract(payload, '$.lifetime_spend') AS DOUBLE) AS lifetime_spend,
            COALESCE(CAST(json_extract(payload, '$.bot') AS BOOLEAN), FALSE) AS bot
        FROM bronze_events
        WHERE event_type = 'player_snapshot'
        """
    )
    con.execute(
        """
        CREATE VIEW silver_matches AS
        SELECT
            json_extract_string(payload, '$.match_id') AS match_id,
            ts,
            json_extract_string(payload, '$.home_id') AS home_id,
            json_extract_string(payload, '$.away_id') AS away_id,
            CAST(json_extract(payload, '$.home_goals') AS INTEGER) AS home_goals,
            CAST(json_extract(payload, '$.away_goals') AS INTEGER) AS away_goals,
            json_extract_string(payload, '$.home_spend_tier') AS home_spend_tier,
            json_extract_string(payload, '$.away_spend_tier') AS away_spend_tier,
            CAST(json_extract(payload, '$.home_ovr') AS INTEGER) AS home_ovr,
            CAST(json_extract(payload, '$.away_ovr') AS INTEGER) AS away_ovr,
            json_extract_string(payload, '$.winner_id') AS winner_id,
            json_extract_string(payload, '$.patch') AS patch,
            json_extract_string(payload, '$.mode') AS mode
        FROM bronze_events
        WHERE event_type = 'match_end'
        """
    )
    con.execute(
        """
        CREATE VIEW silver_chances AS
        SELECT
            json_extract_string(payload, '$.match_id') AS match_id,
            json_extract_string(payload, '$.chance_id') AS chance_id,
            ts,
            player_id AS attacker_id,
            CAST(json_extract(payload, '$.minute') AS INTEGER) AS minute,
            CAST(json_extract(payload, '$.attacking_home') AS BOOLEAN) AS attacking_home,
            CAST(json_extract(payload, '$.trailing_before') AS BOOLEAN) AS trailing_before,
            CAST(json_extract(payload, '$.late') AS BOOLEAN) AS late,
            CAST(json_extract(payload, '$.timing') AS DOUBLE) AS timing,
            json_extract_string(payload, '$.patch') AS patch
        FROM bronze_events
        WHERE event_type = 'chance'
        """
    )
    con.execute(
        """
        CREATE VIEW silver_goals AS
        SELECT
            json_extract_string(payload, '$.match_id') AS match_id,
            json_extract_string(payload, '$.chance_id') AS chance_id,
            ts,
            player_id AS scorer_id,
            CAST(json_extract(payload, '$.minute') AS INTEGER) AS minute,
            CAST(json_extract(payload, '$.late') AS BOOLEAN) AS late,
            CAST(json_extract(payload, '$.trailing_before') AS BOOLEAN) AS trailing_before,
            json_extract_string(payload, '$.patch') AS patch
        FROM bronze_events
        WHERE event_type = 'goal'
        """
    )
    con.execute(
        """
        CREATE VIEW silver_packs AS
        SELECT
            json_extract_string(payload, '$.pack_id') AS pack_id,
            ts,
            player_id,
            json_extract_string(payload, '$.pack_type') AS pack_type,
            CAST(json_extract(payload, '$.advertised_rare_rate') AS DOUBLE) AS advertised_rare_rate,
            CAST(json_extract(payload, '$.observed_rare') AS BOOLEAN) AS observed_rare,
            json_extract_string(payload, '$.rarity') AS rarity,
            CAST(json_extract(payload, '$.ovr') AS INTEGER) AS ovr,
            json_extract_string(payload, '$.patch') AS patch
        FROM bronze_events
        WHERE event_type = 'pack_open'
        """
    )
    con.execute(
        """
        CREATE VIEW silver_trades AS
        SELECT
            json_extract_string(payload, '$.trade_id') AS trade_id,
            ts,
            json_extract_string(payload, '$.seller_id') AS seller_id,
            json_extract_string(payload, '$.buyer_id') AS buyer_id,
            json_extract_string(payload, '$.card_id') AS card_id,
            json_extract_string(payload, '$.rarity') AS rarity,
            CAST(json_extract(payload, '$.price') AS INTEGER) AS price,
            CAST(json_extract(payload, '$.median_ref') AS INTEGER) AS median_ref,
            CAST(json_extract(payload, '$.seconds_listed') AS INTEGER) AS seconds_listed,
            CAST(json_extract(payload, '$.wash') AS BOOLEAN) AS wash,
            json_extract_string(payload, '$.patch') AS patch
        FROM bronze_events
        WHERE event_type = 'market_sale'
        """
    )


def _gold(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("DROP TABLE IF EXISTS gold_match_fairness")
    con.execute("DROP TABLE IF EXISTS gold_pack_odds")
    con.execute("DROP TABLE IF EXISTS gold_market_health")
    con.execute("DROP TABLE IF EXISTS gold_integrity_alerts")
    con.execute("DROP TABLE IF EXISTS gold_daily")
    con.execute("DROP TABLE IF EXISTS gold_spend")

    con.execute(
        f"""
        CREATE TABLE gold_match_fairness AS
        WITH late AS (
            SELECT
                patch,
                COUNT(*) FILTER (WHERE late AND trailing_before) AS trailing_late_chances,
                COUNT(*) FILTER (WHERE late AND trailing_before AND chance_id IN (SELECT chance_id FROM silver_goals)) AS trailing_late_goals
            FROM silver_chances
            GROUP BY patch
        ),
        spend AS (
            SELECT spend_tier, n, wins, wins * 1.0 / n AS win_rate
            FROM (
                SELECT home_spend_tier AS spend_tier, COUNT(*) AS n,
                       COUNT(*) FILTER (WHERE winner_id = home_id) AS wins
                FROM silver_matches GROUP BY 1
                UNION ALL
                SELECT away_spend_tier, COUNT(*),
                       COUNT(*) FILTER (WHERE winner_id = away_id)
                FROM silver_matches GROUP BY 1
            ) s
        ),
        spend_agg AS (
            SELECT spend_tier, SUM(n) AS matches, SUM(wins) AS wins,
                   SUM(wins) * 1.0 / SUM(n) AS win_rate
            FROM spend GROUP BY 1
        )
        SELECT
            l.patch,
            l.trailing_late_chances,
            l.trailing_late_goals,
            l.trailing_late_goals * 1.0 / NULLIF(l.trailing_late_chances, 0) AS late_comeback_rate,
            (SELECT win_rate FROM spend_agg WHERE spend_tier = 'whale') AS whale_win_rate,
            (SELECT win_rate FROM spend_agg WHERE spend_tier = 'f2p') AS f2p_win_rate
        FROM late l
        """
    )

    con.execute(
        f"""
        CREATE TABLE gold_pack_odds AS
        SELECT
            patch,
            COUNT(*) AS packs,
            AVG(CAST(observed_rare AS INTEGER)) AS observed_rare_rate,
            AVG(advertised_rare_rate) AS advertised_rare_rate,
            AVG(CAST(observed_rare AS INTEGER)) - AVG(advertised_rare_rate) AS drift,
            POW(SUM(CAST(observed_rare AS INTEGER)) - COUNT(*) * {ADVERTISED_RARE_RATE}, 2)
                / (COUNT(*) * {ADVERTISED_RARE_RATE}) AS chi_square_stat
        FROM silver_packs
        GROUP BY patch
        """
    )

    con.execute(
        """
        CREATE TABLE gold_market_health AS
        SELECT
            patch,
            COUNT(*) AS trades,
            MEDIAN(price) AS median_price,
            AVG(price) AS avg_price,
            COUNT(*) FILTER (WHERE price > median_ref * 6 AND seconds_listed < 120) AS suspected_wash,
            COUNT(DISTINCT seller_id) FILTER (WHERE price > median_ref * 6 AND seconds_listed < 120) AS wash_accounts
        FROM silver_trades
        GROUP BY patch
        """
    )

    con.execute(
        """
        CREATE TABLE gold_daily AS
        SELECT
            CAST(ts AS DATE) AS day,
            COUNT(DISTINCT match_id) AS matches,
            COUNT(*) AS match_rows
        FROM silver_matches
        GROUP BY 1
        ORDER BY 1
        """
    )

    con.execute(
        """
        CREATE TABLE gold_spend AS
        SELECT spend_tier,
               COUNT(*) AS appearances,
               COUNT(*) FILTER (WHERE winner_id = pid) AS wins,
               COUNT(*) FILTER (WHERE winner_id = pid) * 1.0 / COUNT(*) AS win_rate
        FROM (
            SELECT home_id AS pid, home_spend_tier AS spend_tier, winner_id FROM silver_matches
            UNION ALL
            SELECT away_id, away_spend_tier, winner_id FROM silver_matches
        ) t
        GROUP BY 1
        ORDER BY win_rate DESC
        """
    )

    con.execute(
        f"""
        CREATE TABLE gold_integrity_alerts AS
        SELECT * FROM (
            SELECT
                'momentum' AS alert_id,
                'high' AS severity,
                'Late comeback rate jumped after Whiteout' AS title,
                'Trailing sides convert late chances much more often after Patch 1.12. This is the planted momentum bias.' AS detail,
                late_comeback_rate AS metric
            FROM gold_match_fairness
            WHERE patch = '1.12-whiteout'
              AND late_comeback_rate >= 0.36

            UNION ALL

            SELECT
                'pack_odds',
                'high',
                'Advertised pack odds do not match observed rares',
                'Whiteout Rare packs still advertise 12% but observed rare rate collapsed. Chi-square is against the posted rate.',
                observed_rare_rate
            FROM gold_pack_odds
            WHERE patch = '1.12-whiteout'
              AND observed_rare_rate < 0.08

            UNION ALL

            SELECT
                'coin_ring',
                'critical',
                'Transfer market wash ring after the patch',
                'A tight set of accounts sells commons in under two minutes at 6–14× median. Classic coin-move pattern.',
                suspected_wash
            FROM gold_market_health
            WHERE patch = '1.12-whiteout'
              AND suspected_wash >= 20
        )
        """
    )
    _ = PATCH_TS


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

    def _fetchall(self, sql: str, params: Optional[list] = None) -> list[dict]:
        with _LOCK:
            con = self._connect()
            cur = con.execute(sql, params or [])
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            con.close()
        return _jsonify_rows(rows)

    def _fetchone(self, sql: str, params: Optional[list] = None) -> Optional[dict]:
        rows = self._fetchall(sql, params)
        return rows[0] if rows else None

    def me(self, player_id: str) -> Optional[dict[str, Any]]:
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

    def opponent(self) -> Optional[dict[str, Any]]:
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
        self, *, momentum: Optional[bool] = None, pack_nerf: Optional[bool] = None
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
            _silver(con)
            _gold(con)
            con.close()

    def refresh_marts(self) -> None:
        with _LOCK:
            con = self._connect()
            _silver(con)
            _gold(con)
            con.close()

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
        return self._fetchall("SELECT * FROM gold_integrity_alerts")

    def daily(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_daily ORDER BY day")


# Protocol check at import time for type checkers / sanity.
_: Warehouse = DuckDBWarehouse()  # type: ignore[assignment]
