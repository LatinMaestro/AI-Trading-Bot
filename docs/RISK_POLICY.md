# Risk policy

## Purpose

The user accepts that the allocated capital may be lost, but the system does not interpret that as permission for unlimited or unobservable risk. The policy prevents software and credential failures from turning an intentionally limited experiment into a larger loss.

## Initial hard limits

These are conservative foundation defaults and may only be changed through a reviewed decision-log entry:

- spot positions only;
- approved universe only;
- maximum 90% gross crypto exposure;
- minimum 10% AUD cash buffer;
- one active directional asset at a time during the baseline strategy;
- maximum one portfolio rebalance in 24 hours;
- post-only limit orders by default;
- maximum 2% price deviation from the current validated reference price;
- maximum 5% daily realised-plus-unrealised loss before trading pauses;
- maximum 10% rolling seven-day loss before trading pauses;
- maximum 15% drawdown from high-water mark before the kill switch engages;
- maximum 12% trailing adverse move for a held asset before an exit signal is forced;
- no order when data is stale, incomplete or inconsistent;
- no order while a prior intent has an ambiguous state.

## Position sizing

The baseline strategy may target up to 90% exposure only when:

- the asset passes long-term trend, momentum and liquidity filters;
- volatility is below the configured ceiling;
- the risk engine calculates sufficient cash for fees and price movement;
- the resulting loss at the configured emergency exit remains within the approved risk budget.

The position target is reduced as volatility rises. A strategy cannot override the risk engine.

## Drawdown response

- Warning threshold: reduce new exposure and alert.
- Pause threshold: cancel eligible open orders and prohibit new entries.
- Kill threshold: prohibit all entries; permit only a risk-reducing spot sale after reconciliation.
- Reset: requires a documented review and explicit user approval for live accounts.

## Capital increases

No automatic capital top-up is permitted. Each increase requires explicit approval after reviewing live performance, drawdown, operational incidents, fees, slippage and tax-record completeness.
