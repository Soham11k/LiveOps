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

    def set_alert_state(
        self,
        alert_id: str,
        state: str,
        *,
        actor: str = "ops",
        note: str = "",
    ) -> dict[str, Any]:
        """Persist incident triage state (open / ack / resolved)."""
        ...

    def alert_states(self) -> dict[str, dict[str, Any]]:
        """Map alert_id -> {state, actor, note, updated_at}."""
        ...

    def alert_evidence(self, alert_id: str) -> dict[str, Any]:
        """Compiled SQL + lineage for an alert's source model from dbt manifest."""
        ...

    def daily(self) -> list[dict[str, Any]]:
        ...

    def quality(self) -> dict[str, Any]:
        """Last dbt run / freshness summary for the LiveOps quality panel."""
        ...

    def integrity_tests(self) -> list[dict[str, Any]]:
        """Two-proportion z-tests with Wilson CIs from gold.integrity_tests."""
        ...

    def ingest_ticks(self, match_id: str, ticks: list[dict[str, Any]], *, player_id: str = "", patch: str = "1.12-whiteout") -> int:
        """Batch-insert high-frequency match ticks into bronze.match_ticks."""
        ...

    def replay(self, match_id: str) -> dict[str, Any]:
        """Ordered tick stream for a match, with teleport flags when available."""
        ...

    def flagged_matches(self, limit: int = 20) -> list[dict[str, Any]]:
        """Matches with suspected speed-hack / teleport ticks."""
        ...

    def pipeline(self) -> dict[str, Any]:
        """LiveOps strip: backend location, bronze tick counts, dbt quality."""
        ...
