{{ config(severity='warn', tags=['integrity']) }}

-- CONTRACT: a patch does not quietly change how often losing sides rescue games.
--
-- Deliberately written as a regression against the previous patch rather than
-- a fixed number. An absolute threshold would need re-tuning every time the
-- meta shifted; comparing each release to the last one asks the question live
-- ops actually asks, which is "did we change something we did not mean to?"
--
-- A 50% relative jump in late comeback conversion is far outside normal patch
-- drift and is the fingerprint of a hidden momentum assist.

with baseline as (

    select late_comeback_rate as baseline_rate
    from {{ ref('fct_match_fairness') }}
    where patch = '{{ var("baseline_release") }}'

)

select
    f.patch,
    f.trailing_late_chances,
    f.trailing_late_goals,
    f.late_comeback_rate,
    b.baseline_rate,
    f.late_comeback_rate / nullif(b.baseline_rate, 0) as times_baseline

from {{ ref('fct_match_fairness') }} f
cross join baseline b
where f.patch != '{{ var("baseline_release") }}'
  and f.late_comeback_rate > b.baseline_rate * 1.5
