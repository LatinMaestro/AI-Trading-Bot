# Volatility-expansion research candidate

Status: research-only and unselected. This candidate is not connected to the
paper or live runtime and grants no selection, activation or execution
authority.

## Deterministic baseline

- Signals use complete contiguous hourly closes bound to one exact signal-time
  AUD market-universe snapshot.
- Baseline volatility uses 168 hours ending before the latest 12-hour window.
  A distinct 48-hour pre-expansion window must have volatility no greater than
  0.75 times that baseline.
- Entry requires 12-hour realised volatility at least 1.5 times baseline,
  positive price impulse of at least 1%, a new prior-candle-only 48-hour close
  high and price above the 168-hour EMA.
- Eligible entries are ranked by a fixed expansion score with pair name as the
  deterministic tie-breaker.
- A held position exits to AUD below the prior 24-hour close low or 168-hour
  EMA. An exit never rotates on the same signal.
- Otherwise, a 12-hour minimum hold and 0.05 score-lead hysteresis limit
  turnover. At most one position is targeted at 95% exposure; the alternative
  is AUD cash.

The constants are hypotheses for walk-forward and final-holdout research, not
approved production parameters.

## Evidence boundaries

Baseline and compression windows end before the recent expansion window, and
price channels exclude the current candle. The candidate rejects malformed or
unsorted membership, missing or extra histories, non-hourly observations,
mismatched signal times, invalid policy values, future-dated positions and
unbounded inputs. Its canonical digest binds policy, universe identity,
signals and decision.

This slice does not claim survivorship-safe data, after-cost performance,
capacity, ruin, objective-path or holdout evidence. Those remain required
before readiness review. The authoritative BTC/AUD and ETH/AUD hourly runtime,
one-position limit and AUD-cash fallback are unchanged.
