import os
from pathlib import Path

import pytest

from simulator.config import DB_PATH
from warehouse.build import connect
from warehouse.snowflake_backend import snowflake_env_ready


def setup_module() -> None:
    if not Path(DB_PATH).exists():
        from simulator.generate import main

        main()


def test_planted_alerts_fire():
    con = connect()
    alerts = {
        row[0]
        for row in con.execute("SELECT alert_id FROM gold_integrity_alerts").fetchall()
    }
    con.close()
    assert "momentum" in alerts
    assert "pack_odds" in alerts
    assert "coin_ring" in alerts


def test_pack_drift_after_patch():
    con = connect()
    row = con.execute(
        """
        SELECT observed_rare_rate, advertised_rare_rate
        FROM gold_pack_odds
        WHERE patch = '1.12-whiteout'
        """
    ).fetchone()
    con.close()
    assert row is not None
    observed, advertised = row
    assert observed < 0.08
    assert advertised == pytest.approx(0.12)


def test_late_goals_jump():
    con = connect()
    rows = dict(
        con.execute(
            "SELECT patch, late_comeback_rate FROM gold_match_fairness"
        ).fetchall()
    )
    con.close()
    assert rows["1.12-whiteout"] > rows["1.11"]
    assert rows["1.12-whiteout"] >= 0.36


def test_gold_spend_exists():
    con = connect()
    n = con.execute("SELECT COUNT(*) FROM gold_spend").fetchone()[0]
    con.close()
    assert n >= 3


@pytest.mark.skipif(not snowflake_env_ready(), reason="Snowflake credentials not configured")
def test_snowflake_smoke():
    # Force a fresh factory after env is present.
    from warehouse import get_warehouse

    get_warehouse.cache_clear()
    os.environ["WAREHOUSE_BACKEND"] = "snowflake"
    get_warehouse.cache_clear()
    wh = get_warehouse()
    assert wh.backend_name() == "snowflake"
    assert wh.ready()
    alerts = {a["alert_id"] for a in wh.alerts()}
    assert "momentum" in alerts
    assert "pack_odds" in alerts
    assert "coin_ring" in alerts
    get_warehouse.cache_clear()
    os.environ["WAREHOUSE_BACKEND"] = "duckdb"
