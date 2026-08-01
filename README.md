# AI Crypto Trader

AI Crypto Trader is a private, fail-closed research and automation platform for systematic **spot-only** cryptocurrency trading from Australia.

The aspirational objective is to grow an initial **US$200** allocation toward **US$1,000,000**. That requires a 5,000× return and cannot be promised or made safe by software. The project therefore optimises for long-run risk-adjusted growth, auditability and capital survival while keeping live execution disabled until explicit activation gates are satisfied.

## Current state

- Phase 0 foundation only.
- Research, paper and shadow modes are allowed.
- Live trading is disabled by default and requires explicit configuration plus a separate activation secret.
- No wallet connection, seed phrase, private key, exchange password or 2FA code is accepted.
- No leverage, margin, futures, borrowing, lending, staking, shorting, transfers or withdrawals are implemented.
- Kraken spot is the primary planned venue because its API permissions can exclude withdrawals.
- CoinJar is excluded from unattended execution because its current Exchange API security documentation says API keys have full control, including transfers.

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
