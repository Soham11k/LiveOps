"""Apply Snowflake Streams / Tasks / clustering from Python."""

from __future__ import annotations

from warehouse.snowflake_backend import (
    SQL_DIR,
    connect_snowflake,
    run_sql_file,
    snowflake_env_ready,
)


def apply() -> None:
    if not snowflake_env_ready():
        raise SystemExit("Snowflake credentials missing.")
    con = connect_snowflake()
    cur = con.cursor()
    run_sql_file(cur, SQL_DIR / "04_stream_task.sql")
    # RBAC is opt-in: needs ACCOUNTADMIN and may fail on trial roles.
    rbac = SQL_DIR / "05_rbac.sql"
    try:
        run_sql_file(cur, rbac)
        print("Applied stream/task + RBAC.")
    except Exception as exc:  # noqa: BLE001
        print(f"Applied stream/task. RBAC skipped ({exc}).")
    con.close()


def main() -> None:
    apply()


if __name__ == "__main__":
    main()
