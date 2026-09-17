"""Compatibility shim. Prefer warehouse.duckdb_backend."""

from warehouse.duckdb_backend import connect, load_bronze, rebuild

__all__ = ["connect", "load_bronze", "rebuild"]
