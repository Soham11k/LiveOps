-- CONTRACT: the goals we logged add up to the score we reported.
--
-- Unlike the integrity tests, this one guards the pipeline rather than the
-- game. Goals arrive as their own event stream while the final score arrives
-- on match_end, so the two can disagree if events are dropped in transit,
-- delivered twice, or written to the wrong match. Reconciling independent
-- sources against each other catches that class of bug, which row counts and
-- null checks never will.
--
-- Severity is `error`: no finding here is ever acceptable.

with goals_logged as (

    select match_id, count(*) as goals_logged
    from {{ ref('stg_goals') }}
    group by match_id

),

score_reported as (

    select match_id, home_goals + away_goals as goals_reported
    from {{ ref('stg_matches') }}

)

select
    s.match_id,
    s.goals_reported,
    coalesce(g.goals_logged, 0) as goals_logged,
    s.goals_reported - coalesce(g.goals_logged, 0) as discrepancy

from score_reported s
left join goals_logged g
    on s.match_id = g.match_id
where s.goals_reported != coalesce(g.goals_logged, 0)
