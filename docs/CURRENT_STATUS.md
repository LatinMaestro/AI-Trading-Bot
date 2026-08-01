# Current status

Last verified: 1 August 2026 (Australia/Brisbane)

## Integration checkpoint

- Repository: `LatinMaestro/AI-Trading-Bot`
- Verified base `main`: `6f17d5df0bbedcdb28758e9422f8e7cda880812f`
- Pull requests #1 through #6, #8, #9, #11 through #15, #17, #19 and #21 are repaired, exact-head validated and squash-merged; PRs #7, #10, #16, #18, #20 and #22 are closed without merge.
- This tree reconstructs pull request #23 as allowlisted official Kraken lifecycle evidence directly on that verified base.
- The remaining draft stack was created on historical ancestry. Each later pull request must be reconstructed as a focused delta on the latest verified `main`.
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

## Exact merged evidence

- PR #1 run [30683491866](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30683491866): locked validation passed with 12 tests.
- PR #2 run [30685163521](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685163521): locked validation passed with 25 tests.
- PR #3 run [30685331786](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30685331786): locked validation passed with 33 tests.
- PR #4 run [30687339258](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687339258): locked validation passed with 42 tests.
- PR #5 run [30687528855](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30687528855): locked validation passed with 42 tests.
- PR #6 run [30689248766](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689248766): locked validation passed with 51 tests.
- PR #8 run [30689578186](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689578186): locked validation passed with 67 tests.
- PR #9 run [30689770015](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689770015): locked validation passed with 72 tests.
- PR #11 run [30689958962](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30689958962): lockfile reproduction, paper type generation, strict TypeScript, 77 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #12 run [30690340466](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30690340466): lockfile reproduction, paper type generation, strict TypeScript, 87 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #13 run [30690624243](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30690624243): lockfile reproduction, paper type generation, strict TypeScript, 96 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #14 run [30690795113](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30690795113): lockfile reproduction, paper type generation, strict TypeScript, 96 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #15 run [30691290356](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30691290356): lockfile reproduction, paper type generation, strict TypeScript, 102 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #17 run [30691425536](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30691425536): lockfile reproduction, paper type generation, strict TypeScript, 108 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #19 run [30691621315](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30691621315): lockfile reproduction, paper type generation, strict TypeScript, 114 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.
- PR #21 run [30691823979](https://github.com/LatinMaestro/AI-Trading-Bot/actions/runs/30691823979): lockfile reproduction, paper type generation, strict TypeScript, 123 tests, paper dry-run, forbidden/secret/import-boundary scans and zero-vulnerability audit passed.

## Universe-ingestion evidence

- Creates deterministic content-addressed batches from separate public metadata, quality, official lifecycle and AUD-conversion evidence.
- Timestamps definitions and observations no earlier than the source fetch that made them knowable.
- Retains published future-effective lifecycle events without applying them early and never infers delisting from snapshot absence.
- Resolves fresh shortest-path AUD valuations while rejecting missing, multiple, stale, chronologically invalid or non-finite paths.
- Converts turnover, execution depth and minimum-order values into AUD.
- Produces venue-specific tier-calibration summaries while rejecting mixed venues and conflicting natural identities.
- Calibration is evidence only; it does not automatically change signed policy or runtime scope.
- Scheduled adapters, atomic persistence and complete official lifecycle coverage remain incomplete.

## Tax-export evidence

- Preserves factual transaction records before tax treatment or lot selection is complete.
- Requires canonical UTC timestamps and matching Australian local dates in validated Australian IANA time zones.
- Requires explicit complete acquisition-to-disposal allocations and rejects unknown enums, asset mismatches, later acquisitions, non-reciprocal links and over-allocation.
- Produces formula-neutralised transaction, CGT-allocation and Australian financial-year CSV exports plus canonical machine-readable bundles.
- Content digests prove identity only; tax treatment, lot-selection policy, discounts, exemptions, losses and capital-versus-revenue classification remain professional-review decisions.
- Immutable fill ingestion, exchange reconciliation and professional review remain incomplete.

## Security-runbook evidence

- Defines minimum-permission provisioning, current-cycle permission checks, quarterly rotation and revocation drills without storing secrets.
- Defines SEV-1 through SEV-3 playbooks for compromise, unknown orders, reconciliation drift, stale data, Cloudflare/D1 failure and supply-chain compromise.
- Any authorised responder may stop automation; provider-side revocation requires the owner or provider support; live recovery remains owner-only.
- Requires exchange-authoritative reconciliation, redacted evidence digests, exact-head validation, paper/shadow regression and explicit owner recovery approval.
- Runbooks grant no deployment, credential, capital or live authority.

## Universe-persistence evidence

- Persists one immutable batch header, sorted source digests and exact definition, lifecycle-event and quality-observation memberships in one transactional D1 batch.
- A database-enforced commit marker proves declared membership counts are complete; only committed batches are complete research evidence.
- Exact retries are idempotent, while conflicting identity reuse, venue mismatch, partial writes and post-commit membership extension fail closed.
- Fixed nine-statement batching avoids D1 subrequest growth with universe size.
- Persistence grants no strategy-selection, runtime, deployment or order authority.

## Kraken public-quality evidence

- Uses official `assetVersion=1` AssetPairs, Ticker and Depth contracts with Australian, currency-class and international-venue filtering where supported.
- Binds each accepted response to its public URL, fetch time and exact response-text digest before typed parsing.
- Rejects redirects, unexpected media types, incomplete requested ticker sets, malformed numeric values, legacy pair keys, crossed markets, unordered books, unsafe timestamps and non-finite arithmetic.
- Derives 24-hour quote turnover, coherent spread, conservative two-sided depth and candidate-order impact; insufficient depth remains explicitly unavailable.
- Scheduled orchestration, candle/volatility joining, AUD conversion and lifecycle completeness remain separate required work.
- Public evidence only; no credential, private endpoint, strategy-selection, deployment or order authority.

## Scheduled Kraken universe evidence

- Collects Australian-available spot metadata, all public tickers and a bounded rotating Depth window before strategy evaluation.
- Spaces every public attempt and applies bounded retry, timeout and streaming response-size enforcement.
- Resolves fresh AUD valuation paths, excludes missing/ambiguous paths, derives quality evidence and commits one atomic content-addressed universe batch.
- Records the committed batch identity, request attempts and selected/skipped counts in cycle audit evidence.
- Committed D1 candle history is queried at the exact signal time; incomplete, gapped, stale, shifted or non-finite histories remain explicitly ineligible rather than receiving fabricated completeness.
- The existing BTC/AUD and ETH/AUD approved strategy path remains separate; no private endpoint, credential or order authority is added.

## Market-history evidence

- Queries committed 60-minute and 1,440-minute candle counts and contiguity only through the scheduled signal time.
- Retains at most the latest 366 committed daily closes per selected pair, ordered deterministically and bounded by recorded availability.
- Requires the retained sample to end at the latest committed daily candle; shifted or stale contiguous samples fail closed.
- Computes annualised volatility only from verified contiguous daily closes and binds exact history and conversion evidence into the quality digest.
- Loads history only for the bounded selected rotation and rejects material Ticker/Depth time skew.
- This evidence does not grant dynamic-universe strategy selection, deployment or order authority.

## Official lifecycle-source evidence

- Allowlists exact Kraken Blog asset-listing articles, Kraken Support notices and Kraken Status incident/API documents.
- Validates source class, official origin/path, publication/capture chronology, event type and global-versus-Australian scope.
- Accepts published future-effective events as knowable evidence without applying them before their effective time.
- Audits listing, trading-status and Australian-availability history independently for each expected pair and rejects declarations outside that set.
- Complete historical backfill, scheduled raw capture and immutable payload persistence remain incomplete.
- No free-text or language-model extraction, private API, credential, strategy-selection or order authority is added.

## Runtime boundary

- Runtime markets remain `BTC/AUD` and `ETH/AUD` only.
- Decisions remain hourly, deterministic, long-only spot, at most one open position and otherwise AUD cash.
- Live trading remains disabled.
- No withdrawal, transfer, leverage, derivative, earn or wallet-signing capability exists.

## Known integration gap

- `docs/EXTERNAL_INTELLIGENCE.md` is not present on verified `main`. Its staged source-of-truth delta must be reconstructed in dependency order before external-intelligence implementation is treated as authoritative.

## Next action

Validate reconstructed PR #23 at its exact head, inspect every job and log, merge only if all locked gates pass, verify merged bytes, then reconstruct the earliest remaining open dependency.
