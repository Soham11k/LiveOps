# Snowpitch architecture

## Medallion ownership

```
bronze  — Python loaders only (simulator PUT/COPY, live FastAPI inserts)
silver  — dbt staging views (portable JSON macros)
gold    — dbt marts (views on DuckDB, incremental merge tables on Snowflake)
```

`warehouse/dbt_runner.py` is the only transform entrypoint. Duplicate SQL under `transform/snowflake/02_*` / `03_*` was removed so CI and production cannot disagree.

## Two bronze tables

| Table | Grain | Why separate |
|-------|-------|----------------|
| `RAW_EVENTS` / `bronze_events` | One row per game event | Outcome / economy telemetry for fairness marts |
| `MATCH_TICKS` / `bronze_match_ticks` | One row per 100 ms ball sample | 10–100× volume; kinematics only |

Staging `stg_match_ticks` derives `dt_ms`, `dx/dy/dz`, `ball_speed`, and `is_teleport` with `lag()` partitioned by `match_id`. Gold physics marts (`fct_ball_physics`, `fct_tick_integrity`, `fct_ball_heatmap`) never touch `RAW_EVENTS`.

Live client path: `MatchGame3D` samples at 10 Hz → `POST /play/ticks` → `warehouse.ingest_ticks()` multi-row insert. Simulator path: `data/match_ticks.jsonl` loaded alongside events in `load_bronze()`.

## Why Streams + Tasks instead of Dynamic Tables

Dynamic Tables would refresh silver/gold on a lag with less glue code, but:

1. The transform SQL would leave dbt, breaking `dbt build --target duckdb` in GitHub Actions.
2. Integrity singular tests and `vars:` thresholds would no longer share one definition with the paging mart.
3. Portfolio reviewers can read one DAG + one dbt project; they cannot diff a Dynamic Table definition against DuckDB.

So bronze gets a Stream (`RAW_EVENTS_STREAM`). A one-minute Task consumes it into `CHANGE_LOG` and sets `MARTS_STALE=TRUE`. Airflow (or `make dbt` / `POST /ops/refresh`) runs the incremental dbt build and clears the flag.

## Incremental strategy

`fct_match_fairness`, `fct_pack_odds`, `fct_market_health`, `fct_daily_activity` use `unique_key` + `incremental_strategy='merge'` on Snowflake. Watermarks use `max_event_ts` / `day` so only affected patches or days are rewritten. Alert, statistical test, and tick-integrity marts stay full-refresh — they are tiny and must always see the latest patch metrics.

## Naming across warehouses

[`dbt/macros/naming.sql`](../dbt/macros/naming.sql) maps:

| Target | Example relation |
|--------|------------------|
| DuckDB | `main.gold_match_fairness` |
| Snowflake | `SNOWPITCH.GOLD.MATCH_FAIRNESS` |

## Lineage (conceptual)

```
bronze.raw_events
  → stg_players / stg_matches / stg_chances / stg_goals / stg_packs / stg_trades
    → fct_match_fairness / fct_pack_odds / fct_market_health / fct_spend_fairness / fct_daily_activity
      → fct_integrity_alerts
      → fct_integrity_tests

bronze.match_ticks
  → stg_match_ticks
    → fct_ball_physics / fct_tick_integrity / fct_ball_heatmap
      → speed_hack alert + /ops/replay
```

Regenerate the interactive graph:

```bash
make dbt-docs
# then: dbt docs serve --project-dir dbt --port 8081
```

## RBAC

[`transform/snowflake/05_rbac.sql`](../transform/snowflake/05_rbac.sql) creates `SNOWPITCH_LOADER` (bronze write) and `SNOWPITCH_ANALYST` (gold/silver read). Prefer these over `ACCOUNTADMIN` for the API role in `.env`.

## Orchestration

[`dags/snowpitch_daily.py`](../dags/snowpitch_daily.py) task groups: `ingest` → `transform` → `quality` → `publish`, with retries, `execution_timeout`, SLA, and `on_failure_callback`. Local stack: `docker-compose.airflow.yml`.

## Render / client notes

Graphics split: `Pitch.tsx`, `Players.tsx`, `Stadium.tsx`, `StadiumFX.tsx`, quality tiers in `lib/quality.ts`. Asset fetch: `make assets` / `scripts/fetch-assets.sh` (CC0 Poly Haven + ambientCG). Mixamo merge instructions in `apps/web/public/models/README.md`.
