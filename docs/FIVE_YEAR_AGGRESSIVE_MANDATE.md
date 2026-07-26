# Five-year aggressive trading mandate

## Objective

The research objective is to grow an initial **US$200** live allocation toward **US$1,000,000 within five years of the first authorised live-capital activation**.

This is a 5,000× target. It requires approximately 12.29 doublings, 449.28% compound growth per year, or 15.25% compound growth per month for 60 consecutive months.

The objective path is a benchmark for strategy research and progress reporting. It is not a forecast, promise or representation that the result is probable.

### Constant-compounding reference path

| Point from live activation | Reference equity |
| --- | ---: |
| Start | US$200 |
| Year 1 | US$1,098.56 |
| Year 2 | US$6,034.18 |
| Year 3 | US$33,144.54 |
| Year 4 | US$182,056.42 |
| Year 5 | US$1,000,000 |

The dashboard and research reports must show actual equity against this path, but must not conceal drawdown, deposits, withdrawals, fees, tax estimates or strategy changes.

## Capital-risk mandate

The user accepts that the entire approved live allocation may be lost. The bot may therefore research and, after all live gates, use concentrated, high-volatility and high-turnover spot strategies when evidence supports them.

Aggressive capital risk does not authorise operational risk outside the approved experiment:

- no leverage, margin, derivatives, borrowing, lending, staking or shorting;
- no negative-balance strategy;
- no automatic capital top-up;
- no access to withdrawals, transfers, addresses, deposits or wallet signing;
- no use of funds beyond the explicitly approved exchange allocation;
- no secret, permission, stale-data, duplicate-order or reconciliation bypass.

## Market-cap-agnostic universe

The eligible research universe is not limited to blue-chip assets. Any spot cryptocurrency available to an Australian account on an approved venue may be considered, including liquid mid-caps, micro-caps, newly listed assets and assets with a very low nominal unit price.

Nominal unit price is not a measure of cheapness or upside. Universe ranking must instead use market structure and observable evidence.

An asset may enter an approved research tier only when the system can establish:

- current Australian availability and online trading status from venue metadata;
- a supported spot pair and complete Australian-dollar valuation path;
- venue precision, tick size, minimum order and minimum cost;
- sufficient committed data for the applicable established-asset or new-listing research lane;
- measured spread, depth, turnover and likely price impact relative to the current portfolio size;
- explicit listing date and delisting/suspension handling so backtests do not use survivorship-biased universes;
- no leveraged token, inverse token, derivative wrapper or other instrument that defeats the spot-only boundary;
- no unresolved market-data conflict, gap, symbol ambiguity or extraordinary exchange restriction.

A low-cap asset may be accepted despite higher volatility and wider spreads when its modelled after-cost opportunity remains superior. Illiquidity, stale markets, untradeable minimums or unreliable data remain hard rejections.

## Aggressive strategy direction

Research must prioritise strategies capable of exploiting large asymmetric spot moves rather than assuming a slow diversified allocation. Candidate families include:

- cross-sectional momentum and relative-strength rotation across the venue-wide eligible universe;
- multi-timeframe breakout and volatility-expansion strategies;
- trend continuation with rapid rotation when leadership changes;
- short-horizon mean reversion only where spread, fee and fill evidence supports it;
- separate new-listing and high-volatility strategies with explicit listing-date and liquidity controls;
- regime-dependent allocation among approved candidate strategies.

Research may test:

- up to 100% gross spot exposure, subject to a small execution-fee reserve when required;
- a single concentrated position or a small portfolio of the strongest ranked assets;
- hourly decision intervals and multiple rebalances per day;
- maker or taker execution when the realistic net edge justifies the expected cost and fill risk;
- materially wider drawdown tolerance than the conservative foundation defaults.

No large language model may submit or approve an order. Strategy, sizing, risk and execution policies must remain deterministic, versioned and reproducible at the order boundary.

## Evaluation standard

The five-year mandate changes what the project optimises. A candidate is not selected merely for a high Sharpe ratio or low drawdown. Research reports must include:

- after-fee and after-slippage compound return;
- probability and historical frequency of reaching the five-year target path under approved resampling methods;
- probability of losing 50%, 75% and substantially all of the approved capital;
- median and percentile terminal wealth;
- maximum drawdown, time under water and recovery behaviour;
- turnover, capacity and price-impact sensitivity as equity grows;
- sensitivity to maker/taker mix, spread widening and missed fills;
- listing, delisting and survivorship-bias treatment;
- walk-forward, final holdout and parameter-stability evidence;
- comparison with AUD cash, BTC hold, equal-weight hold and the constant-compounding objective path;
- complete Australian-dollar tax-event records.

Strategies may be rejected for excessive ruin probability, fragile parameters, unrealistic fills or an inability to scale, even when one backtest reaches the target.

## Live boundary

This mandate changes research priorities and candidate risk envelopes. It does not activate live trading or automatically replace the currently implemented conservative limits.

A live strategy requires a signed, versioned configuration that states its universe, concentration, turnover, drawdown response, fee model and maximum approved capital. The user must still approve the initial canary and every later capital increase. The bot never receives withdrawal authority.