# Dynamic spot-universe and survivorship contract

## Scope

This Phase 1 contract reconstructs the market-cap-agnostic Australian spot universe that was knowable at a specific historical signal time. It supports established, high-volatility and new-listing research lanes without using a present-day survivor list.

It does not fetch venue metadata, rank strategy signals, place orders, use credentials or activate capital. Venue ingestion and threshold calibration remain separate work.

The authoritative application entrypoint is `src/universe/index.ts`. It wraps the lower-level deterministic reconstruction primitive with integer time/count validation and observation-time freshness enforcement. The repository check `scripts/check-universe-imports.mjs` prevents other production modules from bypassing that facade.

## Immutable evidence records

Migration `0004_market_universe.sql` adds three append-only record classes:

1. `market_universe_definitions` versions canonical and exchange symbols, base and quote assets, instrument classification, source provenance and the time the definition became available.
2. `market_universe_events` records listing, trading-online, suspension, resumption, delisting, Australian enablement and Australian disablement events.
3. `market_quality_observations` records contemporaneous spread, AUD turnover, available quote-volume capacity, estimated impact, venue minimums, AUD valuation completeness, committed history, volatility and data-quality state.

Migration `0005_universe_integer_hardening.sql` requires all historical times and committed-candle counts to be non-negative integers at the database boundary.

Every record carries a SHA-256 payload digest. Exact retries are idempotent. Reusing an explicit or natural identity with different content aborts. Database triggers prevent ordinary update or deletion so a later asset removal cannot erase its historical presence.

## Historical time semantics

Universe reconstruction distinguishes when something happened from when it was knowable:

- `effectiveAtMs` is when a lifecycle change applies;
- `publishedAtMs` is when the source made that change knowable;
- `recordedAtMs` is when the project captured the source;
- `observedAtMs` is the market-quality measurement time;
- `availableAtMs` is when a definition or observation was available to the strategy.

At an `asOfMs` signal time, the system uses only definitions and observations available by that time and only lifecycle events both effective and published by that time. A suspension published later cannot be used to improve an earlier decision. Conflicting simultaneous lifecycle states fail closed.

Observation freshness is measured from `observedAtMs`, not from a later ingestion or availability time. A delayed import can therefore become knowable without making old spread, depth or turnover evidence appear current.

Delisted and Australian-disabled markets remain in the ledger but are ineligible at the applicable signal time. A later documented relisting begins a new listing era and is evaluated under the new-listing rules rather than inheriting the earlier listing age.

## Research tiers

Tier boundaries are versioned policy values rather than global constants.

### Established

An asset is established only after it satisfies the configured minimum listing age and committed daily and hourly history. It then uses established-lane spread, turnover, execution-depth and impact limits.

### High volatility

An asset uses the high-volatility lane only after it has the same established-history evidence and its annualised volatility meets the configured threshold. This lane may use wider but still explicit market-quality limits.

### New listing

An asset within the configured post-listing window may enter the new-listing lane after the required committed hourly history. Assets older than the new-listing window but younger than the established threshold are not silently promoted; they remain ineligible until a defined lane applies.

Nominal token price and market-cap label do not determine eligibility.

## Hard eligibility checks

A candidate is eligible only when all applicable checks pass:

- latest knowable definition is for a genuine spot instrument;
- the pair was listed, online and available to an Australian account at signal time;
- the pair was not delisted or suspended at signal time;
- the latest knowable quality observation is fresh at its measurement time;
- the Australian-dollar valuation path is complete;
- market data has no unresolved gap, conflict, stale or ambiguous state;
- the candidate order is not below the venue minimum;
- committed history satisfies the selected tier;
- observed AUD turnover and execution depth meet the tier policy;
- spread and estimated price impact are within the tier policy.

Every failed check remains visible as a deterministic reason code. The reconstruction returns all historical candidates, not only eligible survivors.

## Relationship to strategy research

A strategy must import the universe API through `src/universe/index.ts` and request a snapshot at its signal timestamp before calculating rankings. It may then rank only `eligiblePairs` from that snapshot. The same signed research configuration must version:

- venue and Australian country scope;
- candidate order size used for minimum and impact testing;
- observation freshness;
- listing-age and history boundaries;
- volatility threshold;
- tier-specific turnover, depth, spread and impact limits;
- source and digest sets used to build the snapshot.

Changing any of those values creates a different research configuration.

## Signed policy and snapshot identity

A universe policy is accepted only as a finite-validity P-256 signature over the exact Australian venue scope, tier thresholds, candidate order size, calibration digests and approval chronology. The public verification key and signed payload are content-addressed; private signing material is never stored.

Each generated snapshot binds the exact signed policy, one database-committed universe-ingestion batch and its complete sorted source-digest membership. Candidate identity, eligibility reasons, lifecycle chronology and eligible-pair membership are re-verified before the snapshot is content-addressed and atomically persisted. Exact retries are idempotent; changed identity reuse, updates and deletions fail closed.

Persistence does not make a snapshot strategy-authoritative. The strategy and backtest orchestrators must still load and verify the exact snapshot at the signal time before using its eligible membership. The backtest boundary now loads one requested persisted snapshot by digest, re-verifies the signed policy and manifest, rejects evidence unavailable or stale at the decision, requires one membership artifact per step and rejects positive targets outside its eligible set. Exits remain permitted after eligibility loss. Runtime strategy-decision binding remains pending.

## Validation evidence

Fourteen focused Node 22 tests prove:

- deterministic established, high-volatility and new-listing classification;
- exclusion of information published or available after the signal time;
- freshness measured from observation time despite delayed ingestion;
- suspension, delisting and Australian-disablement handling;
- relisting as a new listing era;
- rejection of leveraged, inverse and derivative-wrapper instruments;
- fail-closed valuation, data-quality, minimum-order, turnover, depth, spread and impact checks;
- explicit exclusion of assets between configured tier windows;
- rejection of conflicting identities, malformed chronology, fractional time/count values and ambiguous simultaneous lifecycle states;
- sequential application of migrations `0001` through `0005`;
- idempotent immutable D1 records and conflict triggers;
- enforcement of the production import boundary.

Strict TypeScript source checking passes for the universe contracts, reconstruction primitive and hardened facade.

## Remaining work

This contract does not yet:

- capture and persist scheduled official lifecycle source payloads;
- backfill complete listing, trading-status, delisting and Australian-availability history;
- derive cross-pair Australian-dollar valuation paths;
- calibrate tier limits by venue, period, pair and portfolio scale;
- connect the verified membership artifact to runtime strategy-decision orchestration; backtest binding is complete.

No strategy result may claim survivorship-safe venue-wide evidence until those inputs are versioned, reconciled and reproducible.
