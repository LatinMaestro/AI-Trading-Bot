# Current status

Last verified: 1 August 2026 (Australia/Brisbane)

## Integration checkpoint

- Repository: `LatinMaestro/AI-Trading-Bot`
- Verified base `main`: `69038c130e90ec26eec259e0a228bcc377135a7c`
- Pull requests #1 through #6 are repaired, exact-head validated and squash-merged; PR #7 is closed without merge.
- This tree reconstructs pull request #8 as a survivorship-safe research-universe boundary directly on that verified base.
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
- PR #6 run [30689248766](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689248766): lockfile reproduction, paper type generation, strict TypeScript, 51 tests, paper dry-run, forbidden-capability scan, secret scan and zero-vulnerability audit passed.
- The exact-head result for reconstructed PR #8 must be read from GitHub Actions; this document does not assert an unexecuted check.

## Survivorship-safe universe candidate

- Adds immutable market definitions, lifecycle events and quality observations with application and D1 integrity enforcement.
- Reconstructs market eligibility using only evidence available at the signal timestamp.
- Models listing, suspension, resumption, delisting and relisting chronology without present-day membership leakage.
- Requires fresh Australian-availability evidence for every relisting era.
- Applies deterministic established, high-volatility and new-listing tiers plus spread, liquidity, impact, minimum-order, data-quality and instrument-type gates.
- Returns all candidates with explicit reason codes; it grants no strategy-selection, runtime or order authority.
- Synthetic fixtures validate safety invariants only. Authoritative scheduled sources, AUD valuation paths, calibration and signed policy persistence remain incomplete.

## Runtime boundary

- Runtime markets remain `BTC/AUD` and `ETH/AUD` only.
- Decisions remain hourly, deterministic, long-only spot, at most one open position and otherwise AUD cash.
- Live trading remains disabled.
- No withdrawal, transfer, leverage, derivative, earn or wallet-signing capability exists.

## Known integration gap

- `docs/EXTERNAL_INTELLIGENCE.md` is not present on verified `main`. Its staged source-of-truth delta must be reconstructed in dependency order before external-intelligence implementation is treated as authoritative.

## Next action

Validate reconstructed PR #8 at its exact head, inspect every job and log, merge only if all locked gates pass, verify merged bytes, then reconstruct the earliest remaining open dependency.
