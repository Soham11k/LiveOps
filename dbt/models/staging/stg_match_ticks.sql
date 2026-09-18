{{ config(alias='match_ticks') }}

-- High-frequency ball state with derived kinematics.
-- lag() over (match_id order by tick_ms) turns positions into velocity /
-- acceleration; is_teleport flags single-tick jumps that physics cannot explain.

with base as (

    select
        match_id,
        tick_ms,
        minute,
        ball_x,
        ball_y,
        ball_z,
        possession,
        home_goals,
        away_goals,
        phase,
        momentum_on,
        patch,
        player_id,
        ts
    from {{ source('bronze', 'match_ticks') }}

),

kinematics as (

    select
        *,
        lag(tick_ms) over (
            partition by match_id
            order by tick_ms
        ) as prev_tick_ms,
        lag(ball_x) over (
            partition by match_id
            order by tick_ms
        ) as prev_x,
        lag(ball_y) over (
            partition by match_id
            order by tick_ms
        ) as prev_y,
        lag(ball_z) over (
            partition by match_id
            order by tick_ms
        ) as prev_z
    from base

)

select
    match_id,
    tick_ms,
    minute,
    ball_x,
    ball_y,
    ball_z,
    possession,
    home_goals,
    away_goals,
    phase,
    momentum_on,
    patch,
    player_id,
    ts,
    tick_ms - prev_tick_ms as dt_ms,
    ball_x - prev_x as dx,
    ball_y - prev_y as dy,
    ball_z - prev_z as dz,
    case
        when prev_tick_ms is null or tick_ms = prev_tick_ms then null
        else sqrt(
            power(ball_x - prev_x, 2)
            + power(ball_y - prev_y, 2)
            + power(ball_z - prev_z, 2)
        ) / nullif((tick_ms - prev_tick_ms) / 1000.0, 0)
    end as ball_speed,
    case
        when prev_tick_ms is null then false
        else sqrt(
            power(ball_x - prev_x, 2)
            + power(ball_y - prev_y, 2)
            + power(ball_z - prev_z, 2)
        ) >= {{ var('teleport_displacement') }}
    end as is_teleport
from kinematics
