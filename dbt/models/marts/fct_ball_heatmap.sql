{{ config(alias='ball_heatmap') }}

-- Ball position density on a 12x8 pitch grid, per patch.
-- Portable binning (DuckDB has no width_bucket).

select
    patch,
    least(12, greatest(1, cast(floor((ball_x + 21) / 42.0 * 12) + 1 as integer))) as bin_x,
    least(8, greatest(1, cast(floor((ball_z + 14) / 28.0 * 8) + 1 as integer))) as bin_z,
    count(*) as ticks,
    avg(ball_speed) as mean_speed
from {{ ref('stg_match_ticks') }}
where ball_speed is not null
group by 1, 2, 3
