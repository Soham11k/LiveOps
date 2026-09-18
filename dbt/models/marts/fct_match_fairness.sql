{{
  config(
    alias='match_fairness',
    materialized='incremental' if target.type == 'snowflake' else 'view',
    unique_key='patch',
    incremental_strategy='merge'
  )
}}

-- Is the match engine fair, and did a patch change the answer?
--
-- Two independent fairness questions land in one mart because live-ops reads
-- them together:
--   1. Momentum  - does a losing side convert late chances more often than it should?
--   2. Pay-to-win - does spend predict wins?
-- "Late and trailing" is precisely the state a hidden comeback assist would
-- target, so conversion rate inside that slice is the tell.
--
-- On Snowflake this is incremental/merge on patch: new bronze events only
-- force recomputation of affected patches via the staging views.

with late_chances as (

    select
        c.patch,
        {{ count_if('c.late and c.trailing_before') }} as trailing_late_chances,
        {{ count_if('c.late and c.trailing_before and g.chance_id is not null') }} as trailing_late_goals,
        max(c.ts) as max_event_ts
    from {{ ref('stg_chances') }} c
    left join {{ ref('stg_goals') }} g
        on c.chance_id = g.chance_id
    {% if is_incremental() %}
    where c.patch in (
        select distinct patch
        from {{ ref('stg_chances') }}
        where ts > (select coalesce(max(max_event_ts), '1970-01-01'::timestamp) from {{ this }})
    )
    {% endif %}
    group by c.patch

),

sides as (

    select
        home_id as player_id,
        home_spend_tier as spend_tier,
        winner_id
    from {{ ref('stg_matches') }}

    union all

    select
        away_id,
        away_spend_tier,
        winner_id
    from {{ ref('stg_matches') }}

),

win_rate_by_tier as (

    select
        spend_tier,
        {{ share_if('winner_id = player_id') }} as win_rate
    from sides
    group by spend_tier

),

pay_to_win as (

    select
        max(case when spend_tier = 'whale' then win_rate end) as whale_win_rate,
        max(case when spend_tier = 'f2p' then win_rate end) as f2p_win_rate
    from win_rate_by_tier

)

select
    l.patch,
    l.trailing_late_chances,
    l.trailing_late_goals,
    l.trailing_late_goals * 1.0 / nullif(l.trailing_late_chances, 0) as late_comeback_rate,
    p.whale_win_rate,
    p.f2p_win_rate,
    l.max_event_ts
from late_chances l
cross join pay_to_win p
