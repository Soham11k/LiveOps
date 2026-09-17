-- Snowflake-native refresh + governance for Snowpitch.
--
-- Why Streams + Tasks instead of Dynamic Tables:
--   Dynamic Tables would refresh silver/gold on a lag schedule with less code,
--   but they hide the transform SQL from dbt and make CI against DuckDB
--   impossible (there is no Dynamic Table on DuckDB). Keeping transforms in
--   dbt and using a Stream as a dirty-flag means one model definition, two
--   warehouses, and an explicit refresh owned by Airflow / `make dbt`.
--
-- Apply once after `make seed-snowflake`:
--   snowsql -f transform/snowflake/04_stream_task.sql
-- or via warehouse.snowflake_native.apply()

USE DATABASE SNOWPITCH;

-- Clustering: live gameplay and the season simulator both append by time.
ALTER TABLE SNOWPITCH.BRONZE.RAW_EVENTS CLUSTER BY (TS);

CREATE TABLE IF NOT EXISTS SNOWPITCH.BRONZE.MARTS_STALE (
    STALE BOOLEAN,
    MARKED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS SNOWPITCH.BRONZE.CHANGE_LOG (
    CHANGE_ID NUMBER AUTOINCREMENT,
    ACTION STRING,
    EVENT_ID STRING,
    EVENT_TYPE STRING,
    TS TIMESTAMP_NTZ,
    RECORDED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE OR REPLACE STREAM SNOWPITCH.BRONZE.RAW_EVENTS_STREAM
    ON TABLE SNOWPITCH.BRONZE.RAW_EVENTS
    APPEND_ONLY = TRUE;

CREATE OR REPLACE TASK SNOWPITCH.BRONZE.MARK_MARTS_STALE
    WAREHOUSE = COMPUTE_WH
    SCHEDULE = '1 MINUTE'
    WHEN SYSTEM$STREAM_HAS_DATA('SNOWPITCH.BRONZE.RAW_EVENTS_STREAM')
AS
BEGIN
    INSERT INTO SNOWPITCH.BRONZE.CHANGE_LOG (ACTION, EVENT_ID, EVENT_TYPE, TS)
    SELECT METADATA$ACTION, EVENT_ID, EVENT_TYPE, TS
    FROM SNOWPITCH.BRONZE.RAW_EVENTS_STREAM;

    DELETE FROM SNOWPITCH.BRONZE.MARTS_STALE;
    INSERT INTO SNOWPITCH.BRONZE.MARTS_STALE (STALE, MARKED_AT)
    VALUES (TRUE, CURRENT_TIMESTAMP());
END;

-- Resume after creation (Tasks start suspended).
ALTER TASK SNOWPITCH.BRONZE.MARK_MARTS_STALE RESUME;
