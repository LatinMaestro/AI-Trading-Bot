# Current status

Last verified: 1 August 2026 (Australia/Brisbane)

## Integration checkpoint

- Repository: `LatinMaestro/AI-Trading-Bot`
- Verified base `main`: `dbdec3ce7621244bb98a6def441d6ebc4d6a4d89`
- Pull requests #1 through #6, #8 and #9 are repaired, exact-head validated and squash-merged; PRs #7 and #10 are closed without merge.
- This tree reconstructs pull request #11 as mandatory benchmark and content-addressed research-report contracts directly on that verified base.
- The remaining draft stack was created on historical ancestry. Each later pull request must be reconstructed as a focused delta on the latest verified `main`.
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

## Exact merged evidence

- PR #1 run [30683491866](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30683491866): locked validation passed with 12 tests.
- PR #2 run [30685163521](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685163521): locked validation passed with 25 tests.
- PR #3 run [30685331786](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685331786): locked validation passed with 33 tests.
- PR #4 run [30687339258](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687339258): locked validation passed with 42 tests and immutable candle-provenance checks.
- PR #5 run [30687528855](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687528855): locked validation passed with 42 tests.
- PR #6 run [30689248766](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689248766): locked validation passed with 51 tests.
- PR #8 run [30689578186](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689578186): locked validation passed with 67 tests and universe migration/import-boundary coverage.
- PR #9 run [30689770015](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689770015): lockfile reproduction, paper type generation, strict TypeScript, 72 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- The exact-head result for reconstructed PR #11 must be read from GitHub Actions; this document does not assert an unexecuted check.

## Benchmark-report candidate

- Builds deterministic AUD cash, BTC hold, equal-weight hold and five-year objective-path benchmark series.
- Requires identical strategy/benchmark timestamps and explicit reporting currencies.
- Converts objective paths only from positive time-aligned FX rates and binds their source digest to report provenance.
- Reports terminal excess, return difference and maximum-drawdown difference only for comparable currencies.
- Produces content-addressed research-report v1 evidence over exact code, data, universe and configuration identities.
- Rejects missing benchmarks, unbound FX evidence, inconsistent objective/scenario horizons or probabilities, invalid provenance and premature generation.
- Synthetic fixtures validate arithmetic and integrity only. Authoritative after-cost walk-forward, holdout, sensitivity, capacity and ruin evidence remains incomplete.

## Runtime boundary

- Runtime markets remain `BTC/AUD` and `ETH/AUD` only.
- Decisions remain hourly, deterministic, long-only spot, at most one open position and otherwise AUD cash.
- Live trading remains disabled.
- No withdrawal, transfer, leverage, derivative, earn or wallet-signing capability exists.

## Known integration gap

- `docs/EXTERNAL_INTELLIGENCE.md` is not present on verified `main`. Its staged source-of-truth delta must be reconstructed in dependency order before external-intelligence implementation is treated as authoritative.

## Next action

Validate reconstructed PR #11 at its exact head, inspect every job and log, merge only if all locked gates pass, verify merged bytes, then reconstruct the earliest remaining open dependency.
