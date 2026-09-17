{{ config(alias='integrity_alerts') }}

-- The paging layer. Every mart above measures something; this one decides what
-- a live-ops engineer is woken up for, which is why each row carries a severity
-- and a sentence a human can act on rather than just a number.
--
-- Thresholds come from dbt vars, and the same vars back the data tests in
-- tests/. Tuning a threshold therefore moves the alert and its test together
-- and they cannot silently disagree.

select
    'momentum'                                                  as alert_id,
    'high'                                                      as severity,
    'Late comeback rate jumped after Whiteout'                  as title,
    'Trailing sides convert late chances much more often after Patch 1.12. This is the planted momentum bias.' as detail,
    cast(late_comeback_rate as double)                          as metric
from {{ ref('fct_match_fairness') }}
where patch = '{{ var("patched_release") }}'
  and late_comeback_rate >= {{ var('late_comeback_threshold') }}

union all

select
    'pack_odds',
    'high',
    'Advertised pack odds do not match observed rares',
    'Whiteout Rare packs still advertise 12% but observed rare rate collapsed. Chi-square is against the posted rate.',
    cast(observed_rare_rate as double)
from {{ ref('fct_pack_odds') }}
where patch = '{{ var("patched_release") }}'
  and observed_rare_rate < {{ var('pack_rare_threshold') }}

union all

select
    'coin_ring',
    'critical',
    'Transfer market wash ring after the patch',
    'A tight set of accounts sells commons in under two minutes at 6-14x median. Classic coin-move pattern.',
    cast(suspected_wash as double)
from {{ ref('fct_market_health') }}
where patch = '{{ var("patched_release") }}'
  and suspected_wash >= {{ var('wash_trade_threshold') }}
