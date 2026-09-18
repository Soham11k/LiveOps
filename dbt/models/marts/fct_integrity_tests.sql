{{ config(alias='integrity_tests') }}

-- Statistical integrity tests: two-proportion z-tests with Wilson score
-- intervals. Thresholds still gate the paging layer (fct_integrity_alerts);
-- this mart is what you show a compliance partner when they ask "how sure?"
--
-- p_value uses a standard-normal survival lookup (portable across DuckDB and
-- Snowflake; neither dialect needs an erf UDF).

with fairness as (
    select * from {{ ref('fct_match_fairness') }}
),

packs as (
    select * from {{ ref('fct_pack_odds') }}
),

market as (
    select * from {{ ref('fct_market_health') }}
),

momentum as (
    select
        'momentum' as test_id,
        'Late trailing conversion: baseline vs Whiteout' as title,
        b.late_comeback_rate as baseline_rate,
        p.late_comeback_rate as patched_rate,
        p.late_comeback_rate - b.late_comeback_rate as effect_size,
        b.trailing_late_chances as n_baseline,
        p.trailing_late_chances as n_patched,
        b.trailing_late_goals as k_baseline,
        p.trailing_late_goals as k_patched
    from fairness b
    cross join fairness p
    where
        b.patch = '{{ var("baseline_release") }}'
        and p.patch = '{{ var("patched_release") }}'
),

pack_odds as (
    select
        'pack_odds' as test_id,
        'Observed rare rate: baseline vs Whiteout' as title,
        b.observed_rare_rate as baseline_rate,
        p.observed_rare_rate as patched_rate,
        p.observed_rare_rate - b.observed_rare_rate as effect_size,
        b.packs as n_baseline,
        p.packs as n_patched,
        cast(round(b.observed_rare_rate * b.packs) as integer) as k_baseline,
        cast(round(p.observed_rare_rate * p.packs) as integer) as k_patched
    from packs b
    cross join packs p
    where
        b.patch = '{{ var("baseline_release") }}'
        and p.patch = '{{ var("patched_release") }}'
),

coin_ring as (
    select
        'coin_ring' as test_id,
        'Suspected wash share of transfer-market volume' as title,
        b.suspected_wash * 1.0 / nullif(b.trades, 0) as baseline_rate,
        p.suspected_wash * 1.0 / nullif(p.trades, 0) as patched_rate,
        (p.suspected_wash * 1.0 / nullif(p.trades, 0))
        - (b.suspected_wash * 1.0 / nullif(b.trades, 0)) as effect_size,
        b.trades as n_baseline,
        p.trades as n_patched,
        b.suspected_wash as k_baseline,
        p.suspected_wash as k_patched
    from market b
    cross join market p
    where
        b.patch = '{{ var("baseline_release") }}'
        and p.patch = '{{ var("patched_release") }}'
),

speed_hack as (
    -- Impossible-tick rate across all sampled matches (ball_physics has every match).
    select
        'speed_hack' as test_id,
        'Impossible tick rate: baseline vs Whiteout' as title,
        coalesce(b.rate, 0.0) as baseline_rate,
        coalesce(p.rate, 0.0) as patched_rate,
        coalesce(p.rate, 0.0) - coalesce(b.rate, 0.0) as effect_size,
        coalesce(b.n_matches, 1) as n_baseline,
        coalesce(p.n_matches, 1) as n_patched,
        coalesce(b.flagged, 0) as k_baseline,
        coalesce(p.flagged, 0) as k_patched
    from (
        select
            count(*) as n_matches,
            sum(case when teleport_ticks > 0 then 1 else 0 end) as flagged,
            avg(case when teleport_ticks > 0 then 1.0 else 0.0 end) as rate
        from {{ ref('fct_ball_physics') }}
        where patch = '{{ var("baseline_release") }}'
    ) b
    cross join (
        select
            count(*) as n_matches,
            sum(case when teleport_ticks > 0 then 1 else 0 end) as flagged,
            avg(case when teleport_ticks > 0 then 1.0 else 0.0 end) as rate
        from {{ ref('fct_ball_physics') }}
        where patch = '{{ var("patched_release") }}'
    ) p
),

unioned as (
    select * from momentum
    union all
    select * from pack_odds
    union all
    select * from coin_ring
    union all
    select * from speed_hack
),

scored as (
    select
        test_id,
        title,
        baseline_rate,
        patched_rate,
        effect_size,
        n_baseline,
        n_patched,
        k_baseline,
        k_patched,
        (k_baseline + k_patched) * 1.0
        / nullif(n_baseline + n_patched, 0) as p_pool,
        (
            (k_patched * 1.0 / nullif(n_patched, 0))
            + (1.96 * 1.96) / (2 * nullif(n_patched, 0))
            - 1.96 * sqrt(
                greatest(
                    (k_patched * 1.0 / nullif(n_patched, 0))
                    * (1 - k_patched * 1.0 / nullif(n_patched, 0))
                    / nullif(n_patched, 0)
                    + (1.96 * 1.96) / (4 * power(nullif(n_patched, 0), 2)),
                    0
                )
            )
        ) / (1 + (1.96 * 1.96) / nullif(n_patched, 0)) as wilson_low,
        (
            (k_patched * 1.0 / nullif(n_patched, 0))
            + (1.96 * 1.96) / (2 * nullif(n_patched, 0))
            + 1.96 * sqrt(
                greatest(
                    (k_patched * 1.0 / nullif(n_patched, 0))
                    * (1 - k_patched * 1.0 / nullif(n_patched, 0))
                    / nullif(n_patched, 0)
                    + (1.96 * 1.96) / (4 * power(nullif(n_patched, 0), 2)),
                    0
                )
            )
        ) / (1 + (1.96 * 1.96) / nullif(n_patched, 0)) as wilson_high
    from unioned
),

with_z as (
    select
        *,
        case
            when p_pool is null or p_pool <= 0 or p_pool >= 1 then null
            else (patched_rate - baseline_rate) / nullif(
                sqrt(
                    p_pool * (1 - p_pool)
                    * (1.0 / nullif(n_baseline, 0) + 1.0 / nullif(n_patched, 0))
                ),
                0
            )
        end as z_stat
    from scored
)

select
    test_id,
    title,
    baseline_rate,
    patched_rate,
    effect_size,
    n_baseline,
    n_patched,
    k_baseline,
    k_patched,
    z_stat,
    -- Two-sided p from standard normal critical-value bands (portable).
    case
        when z_stat is null then null
        when abs(z_stat) >= 6.0 then 1e-9
        when abs(z_stat) >= 4.0 then 6e-5
        when abs(z_stat) >= 3.29 then 0.001
        when abs(z_stat) >= 2.58 then 0.01
        when abs(z_stat) >= 1.96 then 0.05
        when abs(z_stat) >= 1.64 then 0.10
        else 0.20
    end as p_value,
    wilson_low,
    wilson_high
from with_z
