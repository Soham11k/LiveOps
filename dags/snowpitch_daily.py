"""Snowpitch daily integrity pipeline.

Task groups mirror how an EA LiveOps data team would ship a season day:
  ingest    -> generate / land bronze events
  transform -> dbt build (silver views + incremental gold marts)
  quality   -> source freshness + integrity tests
  publish   -> write a run summary for the LiveOps board

This DAG is readable without Airflow running — reviewers open this file.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.utils.task_group import TaskGroup

log = logging.getLogger(__name__)

REPO = Path(os.environ.get("SNOWPITCH_REPO", "/opt/snowpitch"))
VENV_PYTHON = os.environ.get("SNOWPITCH_PYTHON", sys.executable)
DBT = os.environ.get("SNOWPITCH_DBT", "dbt")
TARGET = os.environ.get("DBT_TARGET", "snowflake")

DEFAULT_ARGS = {
    "owner": "snowpitch",
    "depends_on_past": False,
    "email_on_failure": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=1),
    "sla": timedelta(hours=2),
}


def _on_failure(context):  # noqa: ANN001
    ti = context.get("task_instance")
    log.error(
        "Snowpitch task failed: dag=%s task=%s run_id=%s",
        context.get("dag").dag_id if context.get("dag") else "?",
        ti.task_id if ti else "?",
        context.get("run_id"),
    )


DEFAULT_ARGS["on_failure_callback"] = _on_failure


def publish_run_summary(**_context) -> None:
    """Write a small JSON artifact the LiveOps /ops/quality endpoint can surface."""
    results = REPO / "dbt" / "target" / "run_results.json"
    out = REPO / "data" / "pipeline_runs"
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    summary = {
        "run_id": stamp,
        "target": TARGET,
        "status": "ok" if results.exists() else "missing_results",
        "results_path": str(results),
    }
    if results.exists():
        data = json.loads(results.read_text(encoding="utf-8"))
        summary["elapsed_time"] = data.get("elapsed_time")
        summary["result_count"] = len(data.get("results", []))
    path = out / f"run_{stamp}.json"
    path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log.info("Published pipeline summary -> %s", path)


with DAG(
    dag_id="snowpitch_daily",
    description="Ingest season telemetry, dbt build, integrity tests, publish.",
    default_args=DEFAULT_ARGS,
    schedule_interval="@daily",
    start_date=datetime(2026, 3, 1),
    catchup=False,
    max_active_runs=1,
    tags=["snowpitch", "integrity", "dbt"],
) as dag:

    with TaskGroup("ingest") as ingest:
        generate = BashOperator(
            task_id="generate_events",
            bash_command=(
                f"cd {REPO} && PYTHONPATH=. {VENV_PYTHON} -m simulator.generate "
                f"--scale ${{{{ var.value.get('snowpitch_scale', 'demo') }}}}"
            ),
        )
        load_bronze = BashOperator(
            task_id="load_bronze",
            bash_command=(
                f"cd {REPO} && PYTHONPATH=. {VENV_PYTHON} -m warehouse.snowflake_load"
                if TARGET == "snowflake"
                else f"cd {REPO} && PYTHONPATH=. {VENV_PYTHON} -c "
                f"\"from warehouse.duckdb_backend import load_bronze; load_bronze()\""
            ),
        )
        generate >> load_bronze

    with TaskGroup("transform") as transform:
        dbt_build = BashOperator(
            task_id="dbt_build",
            bash_command=(
                f"cd {REPO} && DBT_PROFILES_DIR={REPO}/dbt "
                f"DUCKDB_PATH={REPO}/data/snowpitch.duckdb "
                f"{DBT} build --project-dir {REPO}/dbt --target {TARGET}"
            ),
        )

    with TaskGroup("quality") as quality:
        freshness = BashOperator(
            task_id="source_freshness",
            bash_command=(
                f"cd {REPO} && DBT_PROFILES_DIR={REPO}/dbt "
                f"DUCKDB_PATH={REPO}/data/snowpitch.duckdb "
                f"{DBT} source freshness --project-dir {REPO}/dbt --target {TARGET}"
            ),
        )
        integrity = BashOperator(
            task_id="integrity_tests",
            bash_command=(
                f"cd {REPO} && DBT_PROFILES_DIR={REPO}/dbt "
                f"DUCKDB_PATH={REPO}/data/snowpitch.duckdb "
                f"{DBT} test --project-dir {REPO}/dbt --target {TARGET} "
                f"--select tag:integrity"
            ),
        )
        freshness >> integrity

    with TaskGroup("publish") as publish:
        summary = PythonOperator(
            task_id="write_run_summary",
            python_callable=publish_run_summary,
        )

    ingest >> transform >> quality >> publish
