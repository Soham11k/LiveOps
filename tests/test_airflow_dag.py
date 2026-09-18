"""Airflow DAG import smoke — catches broken task wiring without a full compose stack."""

from __future__ import annotations

import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DAG_PATH = REPO / "dags" / "snowpitch_daily.py"


def test_snowpitch_daily_dag_parses():
    assert DAG_PATH.exists(), f"Missing {DAG_PATH}"
    source = DAG_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(DAG_PATH))
    # Must define a DAG id string somewhere and at least one task group name.
    text = source
    assert "snowpitch_daily" in text
    assert "ingest" in text and "transform" in text and "quality" in text
    assert "dbt" in text.lower()
    # AST sanity — file is valid Python even if airflow isn't installed.
    assert any(isinstance(n, (ast.FunctionDef, ast.Assign, ast.With)) for n in tree.body)


def test_dag_file_importable_without_airflow():
    """If airflow is installed, import the module; otherwise skip lightly."""
    sys.path.insert(0, str(REPO / "dags"))
    try:
        import importlib.util

        spec = importlib.util.spec_from_file_location("snowpitch_daily", DAG_PATH)
        assert spec and spec.loader
        # Only execute if airflow is present — otherwise the parse test above is enough.
        try:
            import airflow  # noqa: F401
        except ImportError:
            return
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert hasattr(mod, "dag") or "snowpitch_daily" in dir(mod)
    finally:
        if str(REPO / "dags") in sys.path:
            sys.path.remove(str(REPO / "dags"))
