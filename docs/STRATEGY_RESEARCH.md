# Strategy research plan

## Why the baseline is deterministic

With only US$200, excessive turnover, spread and fees can dominate returns. A transparent, low-turnover baseline gives a credible benchmark and makes defects easier to detect than an opaque model.

## Baseline: trend-filtered momentum rotation

Candidate universe begins with liquid AUD spot markets such as BTC, ETH and SOL, subject to live venue discovery and minimum-liquidity checks.

For each candidate:

1. Load at least 220 complete daily candles.
2. Require the latest close above the 200-day exponential moving average.
3. Calculate 7-day, 30-day and 90-day returns.
4. Calculate realised volatility and recent maximum drawdown.
5. Produce a momentum score that rewards consistent positive returns and penalises volatility and drawdown.
6. Select the highest-scoring eligible asset only when its score exceeds the entry threshold; otherwise hold AUD.
7. Apply entry/exit hysteresis and a 24-hour rebalance cooldown.

## Evaluation requirements

Every candidate strategy must include:

- realistic maker and taker fees;
- spread, slippage, rejected orders and partial fills;
- no look-ahead or survivorship leakage;
- expanding or rolling walk-forward evaluation;
- untouched final holdout data;
- benchmark comparison;
- turnover, drawdown, time-under-water and tail-loss reporting;
- parameter-sensitivity and Monte Carlo tests;
- results across bull, bear and sideways regimes.

## Adaptive model phases

Later phases may use a contextual bandit or a small supervised model to choose among pre-approved strategies. The model must not directly create unconstrained orders and must not use paid inference APIs unless separately approved.

## Rejection rules

Reject a strategy that:

- relies on one asset, one regime or one short sample for most profits;
- loses its advantage after realistic costs;
- requires frequent taker orders;
- has unstable parameters;
- has unacceptable drawdown or recovery time;
- cannot be reproduced from versioned data and code.
