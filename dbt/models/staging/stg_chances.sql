{{ config(alias='chances') }}

-- A "chance" is any shooting opportunity. Whether it became a goal lives in
-- stg_goals, joined on chance_id. Keeping them apart is what makes the
-- conversion-rate question answerable at all.

select
    {{ json_str('payload', 'match_id') }}          as match_id,
    {{ json_str('payload', 'chance_id') }}         as chance_id,
    ts,
    player_id                                      as attacker_id,
    {{ json_int('payload', 'minute') }}            as minute,
    {{ json_bool('payload', 'attacking_home') }}   as attacking_home,
    {{ json_bool('payload', 'trailing_before') }}  as trailing_before,
    {{ json_bool('payload', 'late') }}             as late,
    {{ json_float('payload', 'timing') }}          as timing,
    {{ json_str('payload', 'patch') }}             as patch

from {{ source('bronze', 'raw_events') }}
where event_type = 'chance'
