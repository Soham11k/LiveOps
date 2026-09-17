{{ config(alias='players') }}

select
    player_id,
    {{ json_str('payload', 'display_name') }}      as display_name,
    {{ json_str('payload', 'nation') }}            as nation,
    {{ json_int('payload', 'ovr') }}               as ovr,
    {{ json_str('payload', 'spend_tier') }}        as spend_tier,
    {{ json_float('payload', 'lifetime_spend') }}  as lifetime_spend,
    coalesce({{ json_bool('payload', 'bot') }}, false) as bot

from {{ source('bronze', 'raw_events') }}
where event_type = 'player_snapshot'
