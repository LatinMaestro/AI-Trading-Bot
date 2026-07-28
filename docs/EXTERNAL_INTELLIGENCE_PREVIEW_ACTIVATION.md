# External-intelligence Preview activation

## Scope

This runbook covers only the disabled Preview external-intelligence runtime.
It does not authorize resource creation, deployment, credential changes,
provider-term acceptance, or activation. Production must retain
`EXTERNAL_INTELLIGENCE_ENABLED = "false"` with no queue bindings or Cron
triggers.

## Preconditions

- The complete stacked pull-request chain has merged with every required
  exact-head check passing.
- Preview D1 migrations are ready and independently reviewed.
- The current Kraken Status API contract, applicable terms, and source
  identity have been reviewed. A permitted evidence snapshot and its lowercase
  SHA-256 digest are available outside the repository.
- The contract approver and review timestamps are recorded. The contract has a
  finite expiry no more than 366 days after its effective time.
- A candidate manifest has been generated with
  `createKrakenMaintenancePreviewActivationManifest` and independently
  reviewed. Its contract JSON and both content digests exactly match the
  reviewed evidence.
- Preview Queue, dead-letter queue, account access, capacity, and any cost have
  explicit owner approval.

## Required Preview configuration

Only a separately reviewed activation change may set:

- `EXTERNAL_INTELLIGENCE_ENABLED = "true"`;
- `KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON` to the manifest's exact
  `sourceContractJson`.

Never commit credentials, account identifiers, signing material, private
financial data, or the evidence snapshot. Do not copy Preview configuration to
Production.

## Activation sequence

1. Record the exact merged commit and exact-head check evidence.
2. In the approved hosted Cloudflare account, apply the reviewed Preview D1
   migrations and provision the named Queue and dead-letter queue.
3. Generate and record the reviewed source-contract digest and activation
   manifest digest.
4. Re-run lockfile validation, generated Wrangler types, strict TypeScript,
   Vitest, secret scanning, and `wrangler deploy --dry-run --env preview` on
   the exact activation head.
5. Deploy Preview only.
6. Verify the minute Cron, queue consumer, dead-letter routing, D1 records,
   cache state, publication/receipt/availability/assessment latency, and stale
   or delayed feed reporting.
7. Record the first successful capture and persistence evidence. Confirm that
   intelligence remains research-only and cannot submit or approve an order.

## Fail closed and rollback

- Disable external-intelligence collection first, then deploy the reviewed
  Preview rollback.
- Leave Production unchanged.
- Do not silently substitute a source, acquisition mode, evidence digest, or
  source contract.
- Record the incident and inspect the dead-letter queue without replaying
  unreviewed payloads.
- Expire or disable the source contract when licence, identity, origin, or
  acquisition terms drift.

## Evidence record

Retain the exact commit, check runs, source-evidence digest, source-contract
 digest, activation-manifest digest, deployed version identifier, migration
state, Queue and dead-letter queue identifiers, first successful capture,
latency/staleness proof, failure-path proof, and rollback proof.

Stop for owner action before accepting provider terms, incurring cost, creating
hosted resources, supplying secrets, changing hosted variables, deploying, or
activating collection.
