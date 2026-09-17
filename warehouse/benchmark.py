"""Benchmark bronze load + dbt build for the demo scale profile.

Writes data/benchmark.json with wall times. Credits are N/A on DuckDB and
filled from Snowflake query history when credentials are present.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from simulator.config import DATA_DIR, DB_PATH, EVENTS_PATH
from warehouse.dbt_runner import run as dbt_run
from warehouse.duckdb_backend import load_bronze, rebuild


def _count_events() -> int:
    path = Path(EVENTS_PATH)
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as f:
        return sum(1 for _ in f)


def run_demo_benchmark() -> dict:
    from simulator.generate import generate_season

    t0 = time.perf_counter()
    _, n = generate_season(scale="demo")
    gen_s = time.perf_counter() - t0

    # Fresh bronze load
    Path(DB_PATH).unlink(missing_ok=True)
    t1 = time.perf_counter()
    load_bronze(EVENTS_PATH)
    load_s = time.perf_counter() - t1

    t2 = time.perf_counter()
    dbt_run("build", target="duckdb", select="staging")
    staging_s = time.perf_counter() - t2

    t3 = time.perf_counter()
    dbt_run("build", target="duckdb")
    full_s = time.perf_counter() - t3

    # Second build approximates incremental / no-op cost on views
    t4 = time.perf_counter()
    dbt_run("build", target="duckdb", quiet=True)
    rebuild_s = time.perf_counter() - t4

    result = {
        "profile": "demo",
        "backend": "duckdb",
        "rows_loaded": n,
        "generate_seconds": round(gen_s, 3),
        "bronze_load_seconds": round(load_s, 3),
        "dbt_staging_seconds": round(staging_s, 3),
        "dbt_full_build_seconds": round(full_s, 3),
        "dbt_rebuild_seconds": round(rebuild_s, 3),
        "snowflake_credits": None,
        "notes": (
            "DuckDB local run. Snowflake credits require WAREHOUSE_BACKEND=snowflake "
            "and querying ACCOUNT_USAGE.QUERY_HISTORY after seed-snowflake."
        ),
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }

    out = Path(DATA_DIR) / "benchmark.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return result


def main() -> None:
    # Ensure events exist; rebuild path used by tests stays consistent.
    if not Path(EVENTS_PATH).exists():
        from simulator.generate import generate_season

        generate_season(scale="demo")
    run_demo_benchmark()
    # Leave a clean warehouse for subsequent `make test`.
    rebuild(EVENTS_PATH)


if __name__ == "__main__":
    main()
