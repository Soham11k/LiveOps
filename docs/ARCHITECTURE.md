# Snowpitch architecture

## Medallion ownership

```
bronze  — Python loaders only (simulator PUT/COPY, live FastAPI inserts)
silver  — dbt staging views (portable JSON macros)
gold    — dbt marts (views on DuckDB, incremental merge tables on Snowflake)
```

`warehouse/dbt_runner.py` is the only transform entrypoint. Duplicate SQL under `transform/snowflake/02_*` / `03_*` was removed so CI and production cannot disagree.

## Why Streams + Tasks instead of Dynamic Tables

Dynamic Tables would refresh silver/gold on a lag with less glue code, but:

1. The transform SQL would leave dbt, breaking `dbt build --target duckdb` in GitHub Actions.
2. Integrity singular tests and `vars:` thresholds would no longer share one definition with the paging mart.
3. Portfolio reviewers can read one DAG + one dbt project; they cannot diff a Dynamic Table definition against DuckDB.

So bronze gets a Stream (`RAW_EVENTS_STREAM`). A one-minute Task consumes it into `CHANGE_LOG` and sets `MARTS_STALE=TRUE`. Airflow (or `make dbt` / `POST /ops/refresh`) runs the incremental dbt build and clears the flag.

## Incremental strategy

`fct_match_fairness`, `fct_pack_odds`, `fct_market_health`, `fct_daily_activity` use `unique_key` + `incremental_strategy='merge'` on Snowflake. Watermarks use `max_event_ts` / `day` so only affected patches or days are rewritten. Alert and statistical test marts stay full-refresh — they are tiny and must always see the latest patch metrics.

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
