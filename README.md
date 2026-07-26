# AI Crypto Trader

AI Crypto Trader is a private, fail-closed research and automation platform for systematic **spot-only** cryptocurrency trading from Australia.

The aspirational objective is to grow an initial **US$200** allocation toward **US$1,000,000 within five years of first authorised live-capital activation**. That requires a 5,000× return, approximately 449% compound growth per year, and acceptance that the complete approved allocation may be lost. The target cannot be promised or represented as probable.

The project therefore separates two kinds of risk:

- **capital risk may be extremely aggressive** within the explicitly approved exchange allocation;
- **operational and custody risk remains tightly controlled** so the bot cannot withdraw, transfer, borrow, use leverage or reach other funds.

## Strategy mandate

- Research is market-cap agnostic and may consider approved blue chips, mid-caps, micro-caps, newly listed assets and low-nominal-price assets.
- Candidate strategies may use concentrated positions, high volatility, hourly decisions and higher turnover where realistic after-fee evidence supports them.
- Research must report target-path progress, risk of ruin, terminal-wealth distributions, drawdown, fees, slippage, capacity and Australian tax records.
- Nominal coin price is not treated as a measure of value or upside; liquidity, market structure, data quality and after-cost edge are authoritative.
- No large language model participates in real-time order approval or submission.

See [`docs/FIVE_YEAR_AGGRESSIVE_MANDATE.md`](docs/FIVE_YEAR_AGGRESSIVE_MANDATE.md).

## Current state

- Research, paper and shadow modes are allowed.
- Live trading is disabled by default and requires explicit configuration plus a separate activation secret.
- No wallet connection, seed phrase, private key, exchange password or 2FA code is accepted.
- No leverage, margin, futures, options, perpetuals, borrowing, lending, staking, shorting, transfers or withdrawals are implemented.
- Kraken spot is the primary planned venue because its API permissions can exclude withdrawals.
- No exchange account, credential, deployment or capital has been activated by repository work.

## Architecture

- Cloudflare Worker for scheduled orchestration and a minimal health/status API.
- Cloudflare D1 for strategy signals, orders, fills, equity snapshots, risk events, audit records and Australian-dollar tax records.
- Kraken public market data and a scoped spot-trading API adapter.
- Deterministic strategy and risk engines first; adaptive model selection is gated behind walk-forward evidence.
- GitHub Actions for type checking, tests, dependency review and secret scanning.

## Development commands

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npm run deploy:dry
```

Do not add credentials to the repository. Provider secrets must be entered directly into Cloudflare only after the relevant client gate is approved.

Start with [`CODEX_START_PROMPT.md`](CODEX_START_PROMPT.md), [`AGENTS.md`](AGENTS.md) and [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).