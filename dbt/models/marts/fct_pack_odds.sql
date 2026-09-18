{{
  config(
    alias='pack_odds',
    materialized='incremental' if target.type == 'snowflake' else 'view',
    unique_key='patch',
    incremental_strategy='merge'
  )
}}

-- Do the odds printed on the pack match the odds the player actually got?
--
-- drift is the plain-English answer and chi_square_stat is the statistical one:
-- (observed - expected)^2 / expected against the advertised rate. Above ~3.84
-- the gap stops being explainable by luck at 95% confidence, which is the
-- number a compliance conversation actually turns on.

select
    patch,
    count(*) as packs,
    {{ share_if('observed_rare') }} as observed_rare_rate,
    avg(advertised_rare_rate) as advertised_rare_rate,
    {{ share_if('observed_rare') }} - avg(advertised_rare_rate) as drift,
    power(
        {{ count_if('observed_rare') }} - count(*) * {{ var('advertised_rare_rate') }},
        2
    ) / nullif(count(*) * {{ var('advertised_rare_rate') }}, 0) as chi_square_stat,
    max(ts) as max_event_ts

from {{ ref('stg_packs') }}
{% if is_incremental() %}
where patch in (
    select distinct patch
    from {{ ref('stg_packs') }}
    where ts > (select coalesce(max(max_event_ts), '1970-01-01'::timestamp) from {{ this }})
)
{% endif %}
group by patch
