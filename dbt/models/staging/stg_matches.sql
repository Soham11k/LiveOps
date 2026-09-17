{{ config(alias='matches') }}

select
    {{ json_str('payload', 'match_id') }}          as match_id,
    ts,
    {{ json_str('payload', 'home_id') }}           as home_id,
    {{ json_str('payload', 'away_id') }}           as away_id,
    {{ json_int('payload', 'home_goals') }}        as home_goals,
    {{ json_int('payload', 'away_goals') }}        as away_goals,
    {{ json_str('payload', 'home_spend_tier') }}   as home_spend_tier,
    {{ json_str('payload', 'away_spend_tier') }}   as away_spend_tier,
    {{ json_int('payload', 'home_ovr') }}          as home_ovr,
    {{ json_int('payload', 'away_ovr') }}          as away_ovr,
    {{ json_str('payload', 'winner_id') }}         as winner_id,
    {{ json_str('payload', 'patch') }}             as patch,
    {{ json_str('payload', 'mode') }}              as mode

from {{ source('bronze', 'raw_events') }}
where event_type = 'match_end'
