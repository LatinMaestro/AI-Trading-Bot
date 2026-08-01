# Current status

Last verified: 1 August 2026 (Australia/Brisbane)

## Integration checkpoint

- Repository: `LatinMaestro/AI-Trading-Bot`
- Verified base `main`: `09f208d22946780c709f8230a99ed791af90a424`
- Pull requests #1 through #5 are repaired, exact-head validated and squash-merged.
- This tree reconstructs pull request #6 as an execution-aware research calculation primitive directly on that verified base.
- The remaining draft stack was created on historical ancestry. Each later pull request must be reconstructed as a focused delta on the latest verified `main`.
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

## Exact merged evidence

- PR #1 run [30683491866](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30683491866): locked install and lockfile reproduction, paper types, strict TypeScript, 12 tests, paper dry-run and forbidden-capability scan passed.
- PR #2 run [30685163521](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685163521): the same required gates passed with 25 tests.
- PR #3 run [30685331786](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685331786): the same required gates passed with 33 tests.
- PR #4 run [30687339258](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687339258): locked validation passed with 42 tests, immutable candle-provenance checks, paper dry-run, forbidden-capability scan and current-tree secret scan.
- PR #5 run [30687528855](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687528855): locked validation passed with 42 tests, paper dry-run, forbidden-capability scan and current-tree secret scan.
- The exact-head result for reconstructed PR #6 must be read from GitHub Actions; this document does not assert an unexecuted check.

## Execution-backtest candidate

- Adds a pure deterministic target-weight engine with explicit signal and later execution timestamps.
- Models maker/taker fees, spread, adverse selection, taker slippage, square-root impact, participation limits, minimum orders, cash reserves and missed fills.
- Sells reductions before buys and scales cash-constrained multi-asset buys proportionally.
- Invalid chronology, missing marks, duplicate markets or targets, gross spot targets above 100%, negative cash and short positions fail closed.
- Synthetic fixtures validate arithmetic and safety invariants only; no profitability, strategy-selection or runtime authority is claimed.
- Venue calibration, precision, multi-event order lifecycle, historical universe membership and objective-risk analysis remain separate tasks.

## Authoritative runtime boundary

- Current runtime remains deterministic long-only spot for `BTC/AUD` and `ETH/AUD` using hourly candles.
- At most one open position; otherwise AUD cash.
- Existing conservative implementation limits remain active until an exact signed replacement passes research, paper, shadow and owner activation gates.
- Paper mode remains authoritative and live order transmission remains disabled.
- No intelligence system or language model may approve or submit an order.

## Known integration gap

- `docs/EXTERNAL_INTELLIGENCE.md` is not yet present on merged `main`; external-intelligence work remains staged later and must not be reported as integrated.
- No external-intelligence source may approve or submit an order when that work is integrated.

## Next action

Run the complete exact-head PR #6 workflow, inspect every job and log, repair any real failure, and merge only a green reviewed head. Then reconstruct PR #7 as the next focused dependency.
