{{ config(severity='error', tags=['integrity']) }}

-- DETECTOR REGRESSION: planted momentum bias must fire an alert.
-- Returns a row (fail) when the warehouse stops catching the cheat.

select 'momentum' as expected_alert
where not exists (
    select 1
    from {{ ref('fct_integrity_alerts') }}
    where alert_id = 'momentum'
)
