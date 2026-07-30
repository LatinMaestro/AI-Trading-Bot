# Multi-timeframe breakout research candidate

Status: research-only and unselected. This candidate is not connected to the
paper or live runtime and grants no selection, activation or execution
authority.

## Deterministic baseline

- Signals use complete, contiguous hourly close histories bound to one exact
  signal-time AUD market-universe snapshot.
- Entry requires a new 24-hour close high, proximity to the prior 168-hour
  close high, positive 168-hour and 720-hour returns, price above the 720-hour
  EMA and 24-hour realised volatility at least 1.05 times 168-hour realised
  volatility.
- Channel highs and lows exclude the current signal candle. The decision is
  emitted for the next hourly boundary.
- Eligible entries are ranked by a fixed breakout score. Pair name is the
  deterministic tie-breaker.
- A held position exits to AUD when it falls below the prior 72-hour close low
  or the 720-hour EMA. An exit never rotates on the same signal.
- Otherwise, a 24-hour minimum hold and 0.05 score-lead hysteresis limit
  turnover. At most one position is targeted at 95% exposure; the alternative
  is AUD cash.

The constants are hypotheses for walk-forward and final-holdout research, not
approved production parameters.

## Fail-closed boundaries

The decision rejects malformed or unsorted membership, extra or missing
histories, non-hourly observations, mismatched signal times, invalid policy
values, future-dated positions and unbounded inputs. Its canonical digest
binds the policy, source-universe identity, signals and decision.

This slice does not claim survivorship-safe data, after-cost performance,
capacity, ruin, objective-path or final-holdout evidence. Those remain required
before readiness review. The authoritative BTC/AUD and ETH/AUD hourly runtime,
one-position limit and AUD-cash fallback are unchanged.
