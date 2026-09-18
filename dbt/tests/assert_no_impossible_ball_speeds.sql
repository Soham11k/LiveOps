{{ config(severity='error', tags=['integrity']) }}

-- DETECTOR REGRESSION: planted speed-hack teleports must fire an alert.

select 'speed_hack' as expected_alert
where not exists (
    select 1
    from {{ ref('fct_integrity_alerts') }}
    where alert_id = 'speed_hack'
)
