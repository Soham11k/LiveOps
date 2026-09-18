from __future__ import annotations

import os
from functools import lru_cache

from warehouse.base import Warehouse
from warehouse.duckdb_backend import DuckDBWarehouse, connect, rebuild


def _load_dotenv() -> None:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    env_path = os.path.abspath(env_path)
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # .env wins over stale shell exports (setdefault hid WAREHOUSE_BACKEND=snowflake).
            os.environ[key] = value


@lru_cache(maxsize=1)
def get_warehouse() -> Warehouse:
    _load_dotenv()
    backend = os.getenv("WAREHOUSE_BACKEND", "duckdb").strip().lower()
    if backend == "snowflake":
        from warehouse.snowflake_backend import SnowflakeWarehouse

        return SnowflakeWarehouse()
    return DuckDBWarehouse()


__all__ = ["Warehouse", "get_warehouse", "connect", "rebuild"]
