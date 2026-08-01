# External-intelligence paper activation

## Scope

This runbook covers only the disabled paper external-intelligence runtime. A
generated manifest is a non-activating review artifact: it does not authorize
resource creation, deployment, credential changes, provider-term acceptance or
collection. Production must retain `EXTERNAL_INTELLIGENCE_ENABLED = "false"`
with no Queue bindings or Cron Triggers.

## Preconditions

- The complete dependency chain has merged with every required exact-head check
  passing.
- Paper D1 migrations are ready and independently reviewed.
- The current Kraken Status API contract, applicable terms and source identity
  have been reviewed. A permitted evidence snapshot and its lowercase SHA-256
  digest are available outside the repository.
- The contract approver and review timestamps are recorded. The contract has a
  finite expiry no more than 366 days after its effective time.
- A candidate manifest has been generated with
  `createKrakenMaintenancePaperActivationManifest` and independently
  reviewed. Its canonical contract JSON and content digests exactly match the
  reviewed evidence.
- Paper Queue, dead-letter queue, account access, capacity and any cost have
  explicit owner approval.

## Required paper configuration

Only a separately reviewed, owner-approved activation change may set:

- `EXTERNAL_INTELLIGENCE_ENABLED = "true"`;
- `KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON` to the manifest's exact
  `sourceContractJson`.

Never commit credentials, account identifiers, signing material, private
financial data or the evidence snapshot. Do not copy paper configuration to
Production.

## Activation sequence

1. Record the exact merged commit and exact-head check evidence.
2. Stop for owner approval before accepting provider terms, incurring cost,
   creating hosted resources, changing hosted variables or deploying.
3. In the approved hosted Cloudflare account, apply reviewed paper D1
   migrations and provision the named Queue and dead-letter queue.
4. Generate and record the reviewed source-contract and activation-manifest
   digests.
5. Re-run the locked install, lockfile reproduction, Wrangler paper type
   generation, strict TypeScript, complete tests, secret scans and
   `wrangler deploy --dry-run --env paper` on the exact activation head.
6. Deploy only at a genuine reviewed end-to-end milestone.
7. Verify the minute Cron, Queue consumer, dead-letter routing, D1 records,
   cache state, latency/staleness reporting and deterministic failure paths.
8. Record the first successful capture and persistence evidence. Confirm that
   intelligence remains research/risk-input only and cannot approve or submit
   an order.

## Fail closed and rollback

- Disable external-intelligence collection first, then deploy the reviewed
  paper rollback.
- Leave Production unchanged.
- Never substitute a source, acquisition mode, evidence digest or source
  contract silently.
- Record the incident and inspect the dead-letter queue without replaying
  unreviewed payloads.
- Expire or disable the source contract when licence, identity, origin or
  acquisition terms drift.

## Evidence record

Retain the exact commit, check runs, source-evidence digest, source-contract
digest, activation-manifest digest, deployed version identifier, migration
state, Queue and dead-letter queue identifiers, first successful capture,
latency/staleness proof, failure-path proof and rollback proof.

Stop for owner action before any provider terms, cost, hosted resource, secret,
hosted variable, deployment or activation change.
