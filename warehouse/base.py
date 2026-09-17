from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Warehouse(Protocol):
    """Dialect-neutral warehouse used by the FastAPI layer."""

    def ready(self) -> bool:
        """True when the warehouse has been seeded and can serve reads."""

    def backend_name(self) -> str:
        ...

    def me(self, player_id: str) -> dict[str, Any] | None:
        ...

    def opponent(self) -> dict[str, Any] | None:
        ...

    def get_config(self) -> dict[str, bool]:
        ...

    def set_config(self, *, momentum: bool | None = None, pack_nerf: bool | None = None) -> dict[str, bool]:
        ...

    def ingest_events(self, rows: list[dict[str, Any]]) -> None:
        ...

    def refresh_marts(self) -> None:
        ...

    def listings(self, limit: int = 12) -> list[dict[str, Any]]:
        ...

    def summary(self) -> dict[str, Any]:
        ...

    def fairness(self) -> list[dict[str, Any]]:
        ...

    def packs(self) -> list[dict[str, Any]]:
        ...

    def market(self) -> list[dict[str, Any]]:
        ...

    def spend(self) -> list[dict[str, Any]]:
        ...

    def alerts(self) -> list[dict[str, Any]]:
        ...

    def daily(self) -> list[dict[str, Any]]:
        ...

    def quality(self) -> dict[str, Any]:
        """Last dbt run / freshness summary for the LiveOps quality panel."""
        ...

    def integrity_tests(self) -> list[dict[str, Any]]:
        """Two-proportion z-tests with Wilson CIs from gold.integrity_tests."""
        ...
