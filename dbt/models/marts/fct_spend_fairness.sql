{{ config(alias='spend') }}

-- Win rate per monetisation cohort. If whales beat free-to-play players by far
-- more than their squad rating justifies, the game is selling wins rather than
-- content, which is both a retention risk and a regulatory one.

with sides as (

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

)

select
    spend_tier,
    count(*) as appearances,
    {{ count_if('winner_id = player_id') }} as wins,
    {{ share_if('winner_id = player_id') }} as win_rate

from sides
group by spend_tier
order by win_rate desc
