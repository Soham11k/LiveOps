{{ config(severity='warn', tags=['integrity']) }}

-- CONTRACT: a pack delivers the odds it advertises.
--
-- This is the one integrity check with genuine legal weight. Several markets
-- require published loot-box probabilities to be accurate, so "the store says
-- 12%" is a claim the warehouse should be able to defend on demand.
--
-- Chi-square with one degree of freedom crosses 3.84 at 95% confidence. Below
-- that a shortfall is just variance and paging someone would be noise; above
-- it, with observed under advertised, the rate is genuinely not what was sold.
--
-- Severity is `warn` deliberately: patch 1.12 ships with this defect on
-- purpose, so the demo needs a green build that still reports the finding.
-- Promoting this to `error` is the one-word change that makes the pipeline
-- block a bad release outright.

select
    patch,
    packs,
    advertised_rare_rate,
    observed_rare_rate,
    drift,
    chi_square_stat

from {{ ref('fct_pack_odds') }}
where chi_square_stat > 3.84
  and observed_rare_rate < advertised_rare_rate
