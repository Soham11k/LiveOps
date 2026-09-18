{{ config(alias='integrity_alerts') }}

-- The paging layer. Every mart above measures something; this one decides what
-- a live-ops engineer is woken up for. Each row carries severity, observed
-- metric, the threshold that fired it, the source model, and a detected_at
-- stamp so the incident queue can triage without guessing.

select
    'momentum' as alert_id,
    'high' as severity,
    'Late comeback rate jumped after Whiteout' as title,
    'Trailing sides convert late chances much more often after Patch 1.12. This is the planted momentum bias.'
        as detail,
    cast(late_comeback_rate as double) as metric,
    cast({{ var('late_comeback_threshold') }} as double) as threshold,
    'fct_match_fairness' as source_model,
    cast(current_timestamp as timestamp) as detected_at
from {{ ref('fct_match_fairness') }}
where
    patch = '{{ var("patched_release") }}'
    and late_comeback_rate >= {{ var('late_comeback_threshold') }}

union all

select
    'pack_odds',
    'high',
    'Advertised pack odds do not match observed rares',
    'Whiteout Rare packs still advertise 12% but observed rare rate collapsed. Chi-square is against the posted rate.',
    cast(observed_rare_rate as double),
    cast({{ var('pack_rare_threshold') }} as double),
    'fct_pack_odds',
    cast(current_timestamp as timestamp)
from {{ ref('fct_pack_odds') }}
where
    patch = '{{ var("patched_release") }}'
    and observed_rare_rate < {{ var('pack_rare_threshold') }}

union all

select
    'coin_ring',
    'critical',
    'Transfer market wash ring after the patch',
    'A tight set of accounts sells commons in under two minutes at 6-14x median. Classic coin-move pattern.',
    cast(suspected_wash as double),
    cast({{ var('wash_trade_threshold') }} as double),
    'fct_market_health',
    cast(current_timestamp as timestamp)
from {{ ref('fct_market_health') }}
where
    patch = '{{ var("patched_release") }}'
    and suspected_wash >= {{ var('wash_trade_threshold') }}

union all

select
    'speed_hack',
    'critical',
    'Impossible ball teleports in tick telemetry',
    'One or more matches show single-tick ball jumps that outcome events cannot explain. Open /ops/replay to watch the reconstructed path.',
    cast(sum(teleports) as double),
    cast({{ var('teleport_alert_threshold') }} as double),
    'fct_tick_integrity',
    cast(current_timestamp as timestamp)
from {{ ref('fct_tick_integrity') }}
where patch = '{{ var("patched_release") }}'
having sum(teleports) >= {{ var('teleport_alert_threshold') }}
