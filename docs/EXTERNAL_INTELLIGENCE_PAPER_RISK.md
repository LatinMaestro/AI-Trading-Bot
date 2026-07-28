# External-intelligence paper risk gate

Status: implemented as an undeployed paper-only Phase 1 control. It grants no
live or order authority.

## Decision

The 15-minute trading cycle may consume only immutable integrated assessments
whose effective reaction is `pause-new-risk`. The gate queries assessments no
older than one hour and no later than the scheduled decision time, then
re-verifies every content-addressed integration artifact against its stored row.
Malformed, conflicting, future or over-cap evidence fails the cycle.

A fresh pause suppresses a proposed paper `buy` to `hold` with zero target
exposure. It does not suppress a `sell`, because `pause-new-risk` is not a forced
liquidation instruction. `research`, `shadow`, `validate` and `live` modes remain
disconnected from this gate.

## Evidence and incident handling

Every applied pause creates an idempotent, content-addressed `pause` risk event
containing only the cycle, strategy, proposed action, target pair and assessment
digests. Existing risk-event rows become immutable and changed identity reuse
fails closed. The normal cycle audit records the proposed and resulting action,
gate result and supporting digests.

External intelligence cannot submit or approve an order. Market-data,
liquidity, impact, strategy, signed-policy, portfolio-risk and execution gates
remain authoritative and separate.

## Validation boundary

Hosted tests cover paper-buy suppression, exit preservation, assessment
freshness, non-paper isolation, exact retry idempotency, changed-identity
rejection and immutable risk events. No deployment, provider activation,
credential, fund, wallet or live execution change is included.
