{{ config(alias='ball_physics') }}

-- Per-match / patch ball kinematics summary. Also a telemetry completeness
-- canary: too few ticks means the client sampler dropped packets.

select
    match_id,
    patch,
    count(*) as tick_count,
    avg(ball_speed) as mean_speed,
    {% if target.type == 'snowflake' %}
    percentile_cont(0.95) within group (order by ball_speed) as p95_speed,
    {% else %}
        quantile_cont(ball_speed, 0.95) as p95_speed,
    {% endif %}
    max(ball_speed) as max_speed,
    max(case when is_teleport then 1 else 0 end) as had_teleport,
    sum(case when is_teleport then 1 else 0 end) as teleport_ticks,
    avg(case when possession = 'home' then 1.0 else 0.0 end) as home_possession_share
from {{ ref('stg_match_ticks') }}
where ball_speed is not null
group by 1, 2
