{{ config(alias='tick_integrity') }}

-- Anti-cheat mart: impossible ball speeds and teleports per match / player.

select
    match_id,
    max(player_id) as player_id,
    max(patch) as patch,
    count(*) as tick_count,
    sum(case when ball_speed > {{ var('max_plausible_ball_speed') }} then 1 else 0 end) as impossible_speed_ticks,
    sum(case when is_teleport then 1 else 0 end) as teleports,
    max(ball_speed) as max_speed,
    max(
        case when is_teleport then sqrt(power(dx, 2) + power(dy, 2) + power(dz, 2)) else 0 end
    ) as max_teleport_displacement
from {{ ref('stg_match_ticks') }}
group by 1
having
    sum(case when is_teleport then 1 else 0 end) > 0
    or sum(case when ball_speed > {{ var('max_plausible_ball_speed') }} then 1 else 0 end) > 0
