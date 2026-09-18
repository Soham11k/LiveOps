{{ config(severity='error', tags=['integrity']) }}

-- DETECTOR REGRESSION: planted pack-odds nerf must fire an alert.

select 'pack_odds' as expected_alert
where not exists (
    select 1
    from {{ ref('fct_integrity_alerts') }}
    where alert_id = 'pack_odds'
)
