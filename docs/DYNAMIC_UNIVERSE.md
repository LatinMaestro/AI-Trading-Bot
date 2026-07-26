# Dynamic research universe

- Reconstruct membership at each signal timestamp; never apply today’s market list retrospectively.
- Require exactly one active time-bounded membership record per pair.
- Track listing, suspension and delisting periods separately.
- Exclude unavailable Australian markets, non-spot instruments, missing AUD valuation paths and incomplete data.
- Classify eligible pairs as established, high-volatility or new-listing.
- Gate eligibility using spread, turnover, depth, estimated impact and minimum-order size relative to current equity.
- Treat nominal token price and market-cap label as non-authoritative.
- Fail closed for overlapping membership, duplicate observations or observations before listing.
- Current slice defines pure contracts and evaluation only.
- Next requirement: immutable venue-derived membership persistence and historical provenance.
