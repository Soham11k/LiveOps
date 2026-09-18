{{ config(severity='error', tags=['integrity']) }}

-- DETECTOR REGRESSION: planted coin-ring wash trades must fire an alert.

select 'coin_ring' as expected_alert
where not exists (
    select 1
    from {{ ref('fct_integrity_alerts') }}
    where alert_id = 'coin_ring'
)
