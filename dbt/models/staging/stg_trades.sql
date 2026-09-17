{{ config(alias='trades') }}

-- median_ref is the going rate for the card at sale time, captured inline so
-- the market audit never has to re-derive a price history to spot an outlier.

select
    {{ json_str('payload', 'trade_id') }}          as trade_id,
    ts,
    {{ json_str('payload', 'seller_id') }}         as seller_id,
    {{ json_str('payload', 'buyer_id') }}          as buyer_id,
    {{ json_str('payload', 'card_id') }}           as card_id,
    {{ json_str('payload', 'rarity') }}            as rarity,
    {{ json_int('payload', 'price') }}             as price,
    {{ json_int('payload', 'median_ref') }}        as median_ref,
    {{ json_int('payload', 'seconds_listed') }}    as seconds_listed,
    {{ json_bool('payload', 'wash') }}             as wash,
    {{ json_str('payload', 'patch') }}             as patch

from {{ source('bronze', 'raw_events') }}
where event_type = 'market_sale'
