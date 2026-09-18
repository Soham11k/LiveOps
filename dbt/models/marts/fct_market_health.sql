{{
  config(
    alias='market_health',
    materialized='incremental' if target.type == 'snowflake' else 'view',
    unique_key='patch',
    incremental_strategy='merge'
  )
}}

-- Transfer-market integrity.
--
-- A real sale is a buyer paying roughly the going rate. A card that clears at
-- many times its median inside two minutes is not price discovery, it is two
-- accounts moving coins in the open: the standard signature of RMT or a
-- compromised-account cash-out. wash_accounts matters more than the raw count,
-- because a handful of accounts repeating the trade is a ring rather than noise.

select
    patch,
    count(*) as trades,
    median(price) as median_price,
    avg(price) as avg_price,
    {{ count_if(is_wash_trade()) }} as suspected_wash,
    {{ count_distinct_if(is_wash_trade(), 'seller_id') }} as wash_accounts,
    max(ts) as max_event_ts

from {{ ref('stg_trades') }}
{% if is_incremental() %}
where patch in (
    select distinct patch
    from {{ ref('stg_trades') }}
    where ts > (select coalesce(max(max_event_ts), '1970-01-01'::timestamp) from {{ this }})
)
{% endif %}
group by patch
