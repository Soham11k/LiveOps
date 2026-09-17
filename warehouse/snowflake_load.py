"""Load data/events.jsonl into Snowflake and rebuild silver/gold marts.

Usage:
  PYTHONPATH=. python -m warehouse.snowflake_load
"""

from __future__ import annotations

import os
from pathlib import Path

from simulator.config import EVENTS_PATH
from warehouse.snowflake_backend import SQL_DIR, connect_snowflake, run_sql_file, snowflake_env_ready


def load(events_path: str | None = None) -> None:
    if not snowflake_env_ready():
        raise SystemExit(
            "Missing Snowflake credentials. Copy .env.example to .env and set "
            "SNOWFLAKE_ACCOUNT / SNOWFLAKE_USER / SNOWFLAKE_PASSWORD."
        )

    events = Path(events_path or EVENTS_PATH)
    if not events.exists():
        raise SystemExit(f"Missing {events}. Run `make seed` first to generate events.jsonl.")

    con = connect_snowflake()
    cur = con.cursor()

    run_sql_file(cur, SQL_DIR / "01_bronze.sql")

    cur.execute("CREATE OR REPLACE TABLE SNOWPITCH.BRONZE.RAW_LANDING (PAYLOAD VARIANT)")
    cur.execute("CREATE OR REPLACE STAGE SNOWPITCH.BRONZE.EVENTS_STAGE")

    abs_path = events.resolve().as_posix()
    cur.execute(
        f"PUT file://{abs_path} @SNOWPITCH.BRONZE.EVENTS_STAGE OVERWRITE=TRUE AUTO_COMPRESS=TRUE"
    )
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

    run_sql_file(cur, SQL_DIR / "02_silver.sql")
    run_sql_file(cur, SQL_DIR / "03_gold.sql")

    cur.execute("SELECT COUNT(*) FROM SNOWPITCH.BRONZE.RAW_EVENTS")
    n = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM SNOWPITCH.GOLD.INTEGRITY_ALERTS")
    alerts = cur.fetchone()[0]
    con.close()
    print(f"Loaded {n} events into Snowflake. Integrity alerts: {alerts}")
    print(f"Database={os.getenv('SNOWFLAKE_DATABASE', 'SNOWPITCH')} warehouse ready.")


def main() -> None:
    load()


if __name__ == "__main__":
    main()
