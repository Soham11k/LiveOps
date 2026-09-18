{{ config(alias='packs') }}

-- advertised_rare_rate is carried on every pack event on purpose: it is the
-- promise shown to the player at the moment of purchase. Comparing it to
-- observed_rare is the whole pack-odds audit.

select
    {{ json_str('payload', 'pack_id') }} as pack_id,
    ts,
    player_id,
    {{ json_str('payload', 'pack_type') }} as pack_type,
    {{ json_float('payload', 'advertised_rare_rate') }} as advertised_rare_rate,
    {{ json_bool('payload', 'observed_rare') }} as observed_rare,
    {{ json_str('payload', 'rarity') }} as rarity,
    {{ json_int('payload', 'ovr') }} as ovr,
    {{ json_str('payload', 'patch') }} as patch

from {{ source('bronze', 'raw_events') }}
where event_type = 'pack_open'
