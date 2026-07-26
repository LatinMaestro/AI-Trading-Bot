# Specification source of truth

## Product objective

Build a private, autonomous, systematic cryptocurrency trading service for an Australian resident, beginning with an intended capital allocation of **US$200** and an aspirational target of **US$1,000,000 within five years of first authorised live-capital activation**.

The objective requires a 5,000× increase, approximately 12.29 doublings, 449.28% compound growth per year or 15.25% compound growth per month for 60 months. No strategy, model or platform can guarantee this. The system must never represent the target as probable or assured.

The authoritative risk and research interpretation is in `docs/FIVE_YEAR_AGGRESSIVE_MANDATE.md`.

## Product priorities

In order:

1. Prevent credential theft, unauthorised withdrawals and uncontrolled provider access.
2. Prevent software defects from placing unintended, duplicated or unreconciled orders.
3. Preserve an accurate, immutable audit and Australian-dollar tax record.
4. Bound any loss to the explicitly approved spot capital; never create debt, negative-balance exposure or access to other funds.
5. Maximise the evidence-based probability of reaching the five-year objective after realistic fees, spread, slippage and tax effects.
6. Measure and disclose drawdown, target-attainment probability and risk of substantial or complete loss.
7. Reduce infrastructure cost where that does not compromise the above priorities.

## Functional scope

The complete product is intended to provide:

- market-data ingestion across a dynamic approved spot universe;
- deterministic and adaptive strategy research;
- backtesting, resampling and walk-forward evaluation;
- paper and shadow trading;
- scheduled spot order generation;
- maker- or taker-aware execution and order reconciliation;
- portfolio, risk, drawdown and ruin-probability controls;
- alerts, health checks and a kill switch;
- Australian-dollar performance and tax records;
- a private operations dashboard;
- staged, explicitly approved live-capital activation.

## Approved initial venue direction

- Primary: Kraken spot API, with a key restricted to balance queries and spot order management and with withdrawal/funding permissions disabled.
- Secondary research candidate: CoinSpot, only after documented verification that the selected key can trade while withdrawal functions remain disabled.
- Excluded for unattended execution: any venue or API-key model that grants transfer, withdrawal, address-management or unrestricted account authority.
- Excluded: decentralised exchange and MetaMask automation, because it would require wallet signing authority and expose on-chain transaction, smart-contract, bridge and key-management risks.

## Strategy direction

Research must be aggressive and market-cap agnostic rather than limited to a narrow blue-chip universe. It may consider any approved venue-listed spot asset available to an Australian account, including micro-caps and newly listed assets, after explicit data, liquidity, spread, order-minimum, price-impact and survivorship checks.

The initial research programme begins with explainable cross-sectional momentum and relative-strength rotation, then adds multi-timeframe breakouts, volatility expansion, high-volatility/new-listing lanes and separately tested mean-reversion candidates. It may test concentrated positions, up to 100% gross spot exposure, hourly decisions and multiple daily rebalances. Holding cash remains permitted when no candidate has positive expected after-cost edge.

Do not add machine learning until the deterministic evaluation framework is proven. No model may bypass deterministic risk, permission, idempotency or execution controls.

## Capital stages

1. Research: no account or credentials.
2. Paper: simulated orders against live public data.
3. Shadow: scoped read-only account data; proposed orders are not submitted.
4. Validate-only: exchange validates order payloads where supported; no execution.
5. Canary: a separately approved small live allocation.
6. Graduated live: increases require evidence and explicit approval.

The intended US$200 is not deposited or activated by repository work. No automatic top-up is permitted.