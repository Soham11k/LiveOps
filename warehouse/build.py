"""Compatibility shim — prefer warehouse.duckdb_backend / get_warehouse()."""

from warehouse.duckdb_backend import connect, rebuild
from warehouse.duckdb_backend import _ingest_event as ingest_event
from warehouse.duckdb_backend import _silver, _gold


def refresh_marts(con) -> None:
    _silver(con)
    _gold(con)


__all__ = ["connect", "rebuild", "ingest_event", "refresh_marts"]
