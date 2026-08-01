# External-intelligence assessment integration

Status: implemented as an undeployed, stacked Phase 1 slice. It is not an
activation record and grants no order authority.

## Decision

External-intelligence assessments must be reproduced from the representative
evidence units produced by deterministic correction, exact-syndication and
near-duplicate processing. Raw item counts must not be reintroduced after
linkage.

Three immutable, content-addressed layers are persisted:

1. the correction-effective linkage artifact;
2. the manipulation-evidence artifact bound to that linkage and its policy;
3. an integrated assessment bound to both artifacts and the exact assessment
   policy.

Rapid multi-publisher repost clusters are excluded from actionable
corroboration. They remain watch-only. The sole exception preserves the
fail-safe boundary: an authoritative severe negative event may still produce
`pause-new-risk`. Positive evidence can produce only `research-candidate`.
External intelligence cannot submit or approve an order.

## Persistence

Migration `0013_external_intelligence_assessment_integration.sql` adds
append-only linkage, manipulation-evidence and integrated-assessment tables.
Application validation reproduces every integrated assessment before issuing a
fixed three-statement D1 batch. It also verifies that manipulation clusters form
an exact partition of linkage clusters, reproduce their complete memberships
and bind every selected representative to the corresponding linkage item.
Database constraints bind JSON artifacts to their content digests, enforce
chronology and provenance relationships, reject changed identity reuse, and
prohibit updates and deletes.

The nested base assessment is stored inside the integrated record. The batch
does not depend on a separately pre-populated base-assessment row, so a complete
linkage/manipulation/integration group commits atomically from an empty
integration database.

The integrated record's `effectiveReaction` is the only reaction intended for a
later paper-mode reaction gate. The nested base assessment is retained for
audit. No strategy or trading-cycle consumer is connected in this slice.

## Validation boundary

The focused hosted test covers:

- rapid positive repost suppression;
- independent positive corroboration;
- authoritative severe-negative fail-safe handling;
- deterministic reproduction, cross-artifact partition checks and tamper rejection;
- migration application from empty state, multi-group batching, exact-retry
  idempotency and immutability.

Deployment, provider activation, credentials, funds, wallets and live order
transmission remain unchanged and disabled.
