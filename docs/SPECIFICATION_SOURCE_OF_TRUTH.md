# Specification source of truth

## Product objective

Build a private, autonomous, systematic cryptocurrency trading service for an Australian resident, beginning with an intended capital allocation of **US$200** and an aspirational target of **US$1,000,000**.

The objective requires a 5,000× increase, or approximately 12.3 doublings. No strategy, model or platform can guarantee this. The system must never represent the target as probable, assured or time-bound.

## Product priorities

In order:

1. Prevent credential theft, unauthorised withdrawals and uncontrolled provider access.
2. Prevent software defects from placing unintended orders.
3. Preserve an accurate, immutable audit and tax record.
4. Prevent catastrophic loss through explicit portfolio and execution limits.
5. Optimise long-run risk-adjusted growth after realistic fees and slippage.
6. Reduce infrastructure cost where that does not compromise the above priorities.

## Functional scope

The complete product is intended to provide:

- market-data ingestion;
- deterministic and adaptive strategy research;
- backtesting and walk-forward evaluation;
- paper and shadow trading;
- scheduled spot order generation;
- maker-oriented execution and order reconciliation;
- portfolio, risk and drawdown controls;
- alerts, health checks and a kill switch;
- Australian-dollar performance and tax records;
- a private operations dashboard;
- staged, explicitly approved live-capital activation.

## Approved initial venue direction

- Primary: Kraken spot API, with a key restricted to balance queries and spot order management and with withdrawal/funding permissions disabled.
- Secondary research candidate: CoinSpot, only after documented verification that the selected key can trade while withdrawal functions remain disabled.
- Excluded for unattended execution: CoinJar Exchange under its current API security model because its documentation states each API key has full control of the Exchange account, including transfers.
- Excluded: decentralised exchange and MetaMask automation, because it would require wallet signing authority and expose on-chain transaction, smart-contract, bridge and key-management risks.

## Initial strategy direction

Begin with an explainable, low-turnover, maker-oriented momentum rotation strategy across a narrow high-liquidity spot universe. Hold AUD when no asset passes the trend and risk filters. Do not add machine learning until the deterministic baseline and evaluation framework are proven.

## Capital stages

1. Research: no account or credentials.
2. Paper: simulated orders against live public data.
3. Shadow: scoped read-only account data; proposed orders are not submitted.
4. Validate-only: exchange validates order payloads where supported; no execution.
5. Canary: a separately approved small live allocation.
6. Graduated live: increases require evidence and explicit approval.

The intended US$200 is not deposited or activated by repository work.
