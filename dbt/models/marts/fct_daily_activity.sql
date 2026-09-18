{{
  config(
    alias='daily',
    materialized='incremental' if target.type == 'snowflake' else 'view',
    unique_key='day',
    incremental_strategy='merge'
  )
}}

-- Daily match volume. Doubles as the baseline for the dashboard trend line and
-- as a crude pipeline canary: a day that suddenly loses volume usually means
-- dropped telemetry rather than dropped players.

select
    cast(ts as date) as day,
    count(distinct match_id) as matches,
    count(*) as match_rows,
    max(ts) as max_event_ts

from {{ ref('stg_matches') }}
{% if is_incremental() %}
where cast(ts as date) >= (
    select coalesce(max(day), '1970-01-01'::date)
    from {{ this }}
)
{% endif %}
group by 1
order by 1
