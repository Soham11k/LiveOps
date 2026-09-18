{{ config(alias='goals') }}

select
    {{ json_str('payload', 'match_id') }} as match_id,
    {{ json_str('payload', 'chance_id') }} as chance_id,
    ts,
    player_id as scorer_id,
    {{ json_int('payload', 'minute') }} as minute,
    {{ json_bool('payload', 'late') }} as late,
    {{ json_bool('payload', 'trailing_before') }} as trailing_before,
    {{ json_str('payload', 'patch') }} as patch

from {{ source('bronze', 'raw_events') }}
where event_type = 'goal'
