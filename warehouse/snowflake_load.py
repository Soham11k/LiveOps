"""Load data/events.jsonl (+ match_ticks.jsonl) into Snowflake bronze, then dbt.

Usage:
  PYTHONPATH=. python -m warehouse.snowflake_load
"""

from __future__ import annotations

import os
from pathlib import Path

from simulator.config import EVENTS_PATH, TICKS_PATH
from warehouse.dbt_runner import run as dbt_run
from warehouse.snowflake_backend import (
    SQL_DIR,
    connect_snowflake,
    run_sql_file,
    snowflake_env_ready,
)


def _put_file(cur, local_path: Path, stage: str) -> None:
    abs_path = local_path.resolve().as_posix().replace("'", "\\'")
    # Quote URI so paths with spaces (e.g. /Volumes/Samsung USB/...) parse.
    cur.execute(
        f"PUT 'file://{abs_path}' @{stage} OVERWRITE=TRUE AUTO_COMPRESS=TRUE"
    )


def load(events_path: str | None = None, ticks_path: str | None = None) -> None:
    if not snowflake_env_ready():
        raise SystemExit(
            "Missing Snowflake credentials. Copy .env.example to .env and set "
            "SNOWFLAKE_ACCOUNT / SNOWFLAKE_USER / SNOWFLAKE_PASSWORD."
        )

    events = Path(events_path or EVENTS_PATH)
    ticks = Path(ticks_path or TICKS_PATH)
    if not events.exists():
        raise SystemExit(f"Missing {events}. Run `make seed` first to generate events.jsonl.")
    if not ticks.exists():
        raise SystemExit(f"Missing {ticks}. Run `make seed` first to generate match_ticks.jsonl.")

    con = connect_snowflake()
    cur = con.cursor()

    run_sql_file(cur, SQL_DIR / "01_bronze.sql")

    # --- events ---
    cur.execute("CREATE OR REPLACE TABLE SNOWPITCH.BRONZE.RAW_LANDING (PAYLOAD VARIANT)")
    cur.execute("CREATE OR REPLACE STAGE SNOWPITCH.BRONZE.EVENTS_STAGE")
    _put_file(cur, events, "SNOWPITCH.BRONZE.EVENTS_STAGE")
    cur.execute("TRUNCATE TABLE IF EXISTS SNOWPITCH.BRONZE.RAW_LANDING")
    cur.execute(
        """
        COPY INTO SNOWPITCH.BRONZE.RAW_LANDING (PAYLOAD)
        FROM @SNOWPITCH.BRONZE.EVENTS_STAGE
        FILE_FORMAT = (TYPE = JSON)
        """
    )

    cur.execute("TRUNCATE TABLE SNOWPITCH.BRONZE.RAW_EVENTS")
    cur.execute(
        """
        INSERT INTO SNOWPITCH.BRONZE.RAW_EVENTS (EVENT_ID, EVENT_TYPE, TS, PLAYER_ID, PAYLOAD)
        SELECT
            PAYLOAD:event_id::STRING,
            PAYLOAD:event_type::STRING,
            TO_TIMESTAMP_NTZ(PAYLOAD:ts::STRING),
            PAYLOAD:player_id::STRING,
            PAYLOAD:payload
        FROM SNOWPITCH.BRONZE.RAW_LANDING
        """
    )

    # --- match ticks (needed for speed_hack detector / fct_tick_integrity) ---
    cur.execute("CREATE OR REPLACE TABLE SNOWPITCH.BRONZE.TICKS_LANDING (PAYLOAD VARIANT)")
    cur.execute("CREATE OR REPLACE STAGE SNOWPITCH.BRONZE.TICKS_STAGE")
    _put_file(cur, ticks, "SNOWPITCH.BRONZE.TICKS_STAGE")
    cur.execute("TRUNCATE TABLE IF EXISTS SNOWPITCH.BRONZE.TICKS_LANDING")
    cur.execute(
        """
        COPY INTO SNOWPITCH.BRONZE.TICKS_LANDING (PAYLOAD)
        FROM @SNOWPITCH.BRONZE.TICKS_STAGE
        FILE_FORMAT = (TYPE = JSON)
        """
    )
    cur.execute("TRUNCATE TABLE IF EXISTS SNOWPITCH.BRONZE.MATCH_TICKS")
    cur.execute(
        """
        INSERT INTO SNOWPITCH.BRONZE.MATCH_TICKS (
            MATCH_ID, TICK_MS, MINUTE, BALL_X, BALL_Y, BALL_Z,
            POSSESSION, HOME_GOALS, AWAY_GOALS, PHASE, MOMENTUM_ON,
            PATCH, PLAYER_ID, TS
        )
        SELECT
            PAYLOAD:match_id::STRING,
            PAYLOAD:tick_ms::NUMBER,
            PAYLOAD:minute::FLOAT,
            PAYLOAD:ball_x::FLOAT,
            PAYLOAD:ball_y::FLOAT,
            PAYLOAD:ball_z::FLOAT,
            PAYLOAD:possession::STRING,
            PAYLOAD:home_goals::NUMBER,
            PAYLOAD:away_goals::NUMBER,
            PAYLOAD:phase::STRING,
            PAYLOAD:momentum_on::BOOLEAN,
            PAYLOAD:patch::STRING,
            PAYLOAD:player_id::STRING,
            TO_TIMESTAMP_NTZ(PAYLOAD:ts::STRING)
        FROM SNOWPITCH.BRONZE.TICKS_LANDING
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS SNOWPITCH.BRONZE.LIVE_CONFIG (
            K STRING,
            V STRING
        )
        """
    )
    cur.execute("DELETE FROM SNOWPITCH.BRONZE.LIVE_CONFIG")
    cur.execute(
        """
        INSERT INTO SNOWPITCH.BRONZE.LIVE_CONFIG (K, V) VALUES
            ('momentum', 'true'),
            ('pack_nerf', 'true')
        """
    )
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

    cur.execute("SELECT COUNT(*) FROM SNOWPITCH.BRONZE.RAW_EVENTS")
    n_events = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM SNOWPITCH.BRONZE.MATCH_TICKS")
    n_ticks = cur.fetchone()[0]
    con.close()

    # dbt owns every silver view and gold mart definition.
    dbt_run("build", target="snowflake")

    con = connect_snowflake()
    cur = con.cursor()
    cur.execute(
        "UPDATE SNOWPITCH.BRONZE.MARTS_STALE SET STALE = FALSE, MARKED_AT = CURRENT_TIMESTAMP()"
    )
    try:
        cur.execute("SELECT COUNT(*) FROM SNOWPITCH.GOLD.INTEGRITY_ALERTS")
        alerts = cur.fetchone()[0]
    except Exception:
        alerts = "?"
    con.close()
    print(
        f"Loaded {n_events} events + {n_ticks} ticks into Snowflake. "
        f"Integrity alerts: {alerts}"
    )
    print(f"Database={os.getenv('SNOWFLAKE_DATABASE', 'SNOWPITCH')} warehouse ready via dbt.")


def main() -> None:
    load()


if __name__ == "__main__":
    main()
