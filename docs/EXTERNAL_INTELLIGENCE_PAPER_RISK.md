# External-intelligence paper risk gate

Status: implemented as an undeployed paper-only Phase 1 control. It grants no
live or order authority.

## Decision

The hourly trading cycle may consume only immutable integrated assessments
whose effective reaction is `pause-new-risk`. The gate queries assessments no
older than one hour and no later than the scheduled decision time, then
re-verifies the complete content-addressed linkage, manipulation-evidence and
integrated-assessment chain against its stored rows. Malformed, conflicting,
future or over-cap evidence fails the cycle.

A fresh pause suppresses a proposed paper `buy` to `hold` with zero target
exposure. It does not suppress a `sell`, because `pause-new-risk` is not a
forced-liquidation instruction. Research, shadow, validate and live modes
remain disconnected from this gate.

## Evidence and incident handling

Every fresh pause creates an idempotent, content-addressed `pause` risk event.
Its identity binds the complete proposed and resulting decisions plus the exact
assessment and integration digests. Existing risk-event rows are immutable and
conflicting identity reuse fails closed. The normal cycle audit records the
proposed and resulting action, gate result and supporting digests.

External intelligence cannot submit or approve an order. Market-data,
liquidity, impact, strategy, signed-policy, portfolio-risk and execution gates
remain authoritative and separate.

## Validation boundary

Hosted tests cover paper-buy suppression, exit preservation, assessment
freshness, non-paper isolation, full artifact-chain revalidation, exact retry
idempotency, decision-bound identity and immutable risk events. No deployment,
provider activation, credential, fund, wallet or live-execution change is
included.
