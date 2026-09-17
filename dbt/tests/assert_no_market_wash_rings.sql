{{ config(severity='warn', tags=['integrity']) }}

-- CONTRACT: the transfer market is used for trading, not for moving coins.
--
-- Isolated odd sales happen; a cluster of accounts repeating the same
-- implausible trade does not. The threshold is on the count rather than on any
-- single trade for that reason, and wash_accounts is reported alongside it
-- because a ring of five accounts is a very different investigation from two
-- hundred unrelated players each getting unlucky once.

select
    patch,
    trades,
    suspected_wash,
    wash_accounts,
    suspected_wash * 1.0 / nullif(trades, 0) as share_of_trades

from {{ ref('fct_market_health') }}
where suspected_wash >= {{ var('wash_trade_threshold') }}
