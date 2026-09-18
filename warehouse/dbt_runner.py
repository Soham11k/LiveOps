"""Invoke dbt from Python.

dbt owns every silver and gold definition in this project. The Python layer
loads bronze and reads marts, but it deliberately holds no transform SQL of its
own: a second copy of that logic would drift from the dbt models within a week
and the tests would then be guarding the wrong thing.
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECT_DIR = REPO_ROOT / "dbt"


class DbtError(RuntimeError):
    pass


def _executable() -> str:
    """Prefer the dbt next to the interpreter running us, so a venv is honoured."""
    candidate = Path(sys.executable).parent / "dbt"
    return str(candidate) if candidate.exists() else "dbt"


def run(
    command: str = "build",
    *,
    target: str | None = None,
    select: str | None = None,
    quiet: bool = False,
) -> subprocess.CompletedProcess:
    """Run a dbt command against the Snowpitch project.

    Raises DbtError on failure. Detector regression tests on planted integrity
    bugs are severity=error, so a silent miss fails the build.
    """
    env = {
        **os.environ,
        "DBT_PROFILES_DIR": str(PROJECT_DIR),
        # Pinned absolute so dbt and the FastAPI layer can never disagree about
        # which DuckDB file is the warehouse.
        "DUCKDB_PATH": str(REPO_ROOT / "data" / "snowpitch.duckdb"),
    }

    argv = [_executable(), command, "--project-dir", str(PROJECT_DIR)]
    if target:
        argv += ["--target", target]
    if select:
        argv += ["--select", select]
    if quiet:
        argv.append("--quiet")

    proc = subprocess.run(argv, env=env, cwd=str(PROJECT_DIR), capture_output=True, text=True)
    if proc.returncode != 0:
        raise DbtError(
            f"`dbt {command}` failed with exit code {proc.returncode}.\n"
            f"{proc.stdout[-4000:]}\n{proc.stderr[-2000:]}"
        )
    return proc


def last_run_summary() -> dict:
    """Parse dbt/target/run_results.json for the LiveOps quality panel."""
    results_path = PROJECT_DIR / "target" / "run_results.json"
    if not results_path.exists():
        return {
            "ok": False,
            "message": "No dbt run_results.json yet. Run `make dbt`.",
            "passed": 0,
            "warned": 0,
            "failed": 0,
            "models": 0,
            "elapsed_seconds": None,
        }

    import json

    data = json.loads(results_path.read_text(encoding="utf-8"))
    results = data.get("results", [])
    passed = warned = failed = models = 0
    for r in results:
        status = r.get("status")
        resource = (r.get("unique_id") or "").split(".")[0]
        if resource == "model":
            models += 1
        if status == "pass" or status == "success":
            passed += 1
        elif status == "warn":
            warned += 1
        elif status in {"error", "fail"}:
            failed += 1

    meta = data.get("metadata", {})
    generated = meta.get("generated_at")
    elapsed = data.get("elapsed_time")
    freshness_path = PROJECT_DIR / "target" / "sources.json"
    freshness = None
    if freshness_path.exists():
        try:
            src = json.loads(freshness_path.read_text(encoding="utf-8"))
            freshness = {
                "generated_at": src.get("metadata", {}).get("generated_at"),
                "sources": len(src.get("sources", [])),
            }
        except json.JSONDecodeError:
            freshness = None

    return {
        "ok": failed == 0,
        "message": "dbt last run",
        "passed": passed,
        "warned": warned,
        "failed": failed,
        "models": models,
        "elapsed_seconds": round(elapsed, 2) if isinstance(elapsed, (int, float)) else None,
        "generated_at": generated,
        "freshness": freshness,
        "read_at": datetime.now(timezone.utc).isoformat(),
    }


# Map gold mart aliases to dbt model names under models.snowpitch.marts.
_MODEL_BY_ALIAS = {
    "fct_match_fairness": "fct_match_fairness",
    "fct_pack_odds": "fct_pack_odds",
    "fct_market_health": "fct_market_health",
    "fct_tick_integrity": "fct_tick_integrity",
    "fct_integrity_alerts": "fct_integrity_alerts",
}


def alert_evidence(source_model: str) -> dict:
    """Pull compiled SQL and upstream refs for a mart from dbt/target/manifest.json."""
    import json

    manifest_path = PROJECT_DIR / "target" / "manifest.json"
    if not manifest_path.exists():
        return {
            "compiled_sql": None,
            "upstream_refs": [],
            "message": "No dbt manifest.json. Run `make dbt`.",
        }

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"compiled_sql": None, "upstream_refs": [], "message": "Corrupt manifest.json"}

    nodes = data.get("nodes") or {}
    model_name = _MODEL_BY_ALIAS.get(source_model, source_model)
    node = None
    for uid, n in nodes.items():
        if not uid.startswith("model."):
            continue
        if n.get("name") == model_name or n.get("alias") == model_name.replace("fct_", ""):
            node = n
            break
        # DuckDB aliases drop fct_ prefix sometimes
        if n.get("name") == source_model:
            node = n
            break

    if not node:
        # Fallback: raw model file
        raw = PROJECT_DIR / "models" / "marts" / f"{model_name}.sql"
        sql = raw.read_text(encoding="utf-8") if raw.exists() else None
        return {
            "compiled_sql": sql,
            "upstream_refs": [],
            "message": "Manifest node missing; showing source SQL",
        }

    compiled = (
        node.get("compiled_code")
        or node.get("raw_code")
        or node.get("compiled_sql")
    )
    refs = []
    for dep in node.get("depends_on", {}).get("nodes", []):
        if dep.startswith("model."):
            refs.append(dep.split(".")[-1])
        elif dep.startswith("source."):
            refs.append(".".join(dep.split(".")[-2:]))

    return {
        "compiled_sql": compiled,
        "upstream_refs": refs,
        "unique_id": node.get("unique_id"),
        "message": "ok",
    }
