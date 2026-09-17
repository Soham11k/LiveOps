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
        return self._fetchall("SELECT * FROM gold_integrity_alerts")

    def daily(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_daily ORDER BY day")

    def integrity_tests(self) -> list[dict[str, Any]]:
        return self._fetchall("SELECT * FROM gold_integrity_tests ORDER BY test_id")

    def quality(self) -> dict[str, Any]:
        """Surface the last dbt run results for the LiveOps quality panel."""
        from warehouse.dbt_runner import last_run_summary

        return last_run_summary()


_: Warehouse = DuckDBWarehouse()  # type: ignore[assignment]
