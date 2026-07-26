# Incident response runbook

## Operating rule

Protect the account and evidence before restoring automation. Any operator may stop schedules, activate the kill switch, revoke a credential or cancel an unexpected open order. No operator may re-enable live trading, increase capital or broaden permissions without the applicable client approval.

Never paste secrets or unredacted private responses into chat, GitHub, alerts or incident records.

## Severity

### SEV-1 — immediate containment

- suspected credential, account, repository or Cloudflare compromise;
- unexpected live order, duplicate order or order outside signed limits;
- unknown order state with possible market exposure;
- withdrawal, transfer, address-management, funding, margin or derivative permission detected;
- unexplained balance or ledger change;
- audit, tax or immutable evidence conflict;
- inability to stop scheduled live execution.

### SEV-2 — live operation disabled

- reconciliation drift with no confirmed loss;
- stale, gapped, conflicting or ambiguous market/account data;
- repeated provider, schedule, D1, alert or deployment failure;
- unexpected dependency or configuration drift;
- security control or backup drill failure.

### SEV-3 — research-only degradation

- public-data or reporting failure with no private access or possible order;
- documentation, dashboard or non-authoritative alert defect;
- isolated paper-mode error with complete evidence and no live path.

Escalate whenever scope is uncertain. A lower severity cannot be used to avoid a live-disable gate.

## Universal first response

1. Record the detection time, current mode, deployment identifier and last known successful cycle.
2. For SEV-1 or SEV-2, activate the application kill switch and disable scheduled execution.
3. If credentials or account control may be affected, revoke the exchange key through the exchange interface.
4. Inspect and cancel unexpected open orders through the exchange interface. Do not liquidate positions automatically.
5. Preserve redacted audit, order, fill, balance, permission, deployment and provider evidence with content digests.
6. Identify the incident owner, severity and next update time.
7. Reconcile actual exchange state before trusting application state.
8. Keep research, paper, shadow and live environments separated during investigation.

If the application and exchange disagree, the exchange is authoritative for funds and actual order state; immutable local evidence remains authoritative for what the application attempted and observed.

## Playbook A — credential or account compromise

1. Revoke all affected API keys and active sessions from a trusted device.
2. Change the account password and reset 2FA only through official provider recovery.
3. Verify withdrawal addresses, account permissions, login history, balances and ledgers.
4. Cancel unexpected orders.
5. Rotate related Cloudflare, GitHub and alerting credentials.
6. Search repository history, CI artifacts and logs for exposure without reproducing the secret.
7. Record the earliest possible exposure and every affected system.
8. Obtain provider support evidence where account actions are unexplained.
9. Resume only with a new minimum-permission key and completed recovery gates.

## Playbook B — unexpected, duplicate or ambiguous order

1. Disable scheduled execution and activate the kill switch.
2. Query the exchange directly for open/closed orders, client identifiers, trades and ledger entries.
3. Cancel remaining unexpected open orders.
4. Do not retry an ambiguous create request until exchange state and the deterministic order fingerprint are reconciled.
5. Compare schedule key, lease owner, order intent, request fingerprint, exchange order ID, fills, fees and balances.
6. Preserve network timeouts and response metadata in redacted form.
7. Correct positions only under a reviewed, explicit recovery decision; never hide a loss with an automatic replacement trade.
8. Add a regression or failure-injection case before release.

## Playbook C — balance, fill, fee or tax drift

1. Stop new order submission.
2. Export exchange balances, orders, trades and ledgers for the affected interval.
3. Compare each event to immutable intents, responses, fills and transaction records.
4. Classify timing lag, fee/rounding difference, missing event, duplicate event or unexplained change.
5. Append corrective evidence; never edit or delete immutable history.
6. Require complete AUD valuation provenance and tax-record reconciliation.
7. Escalate unexplained exchange-side activity to SEV-1.
8. Restore private operation only after zero unexplained drift remains.

## Playbook D — stale data, venue outage or market anomaly

1. Fail closed and record the rejected cycle.
2. Do not fill gaps by interpolation or silently substitute a different market/source.
3. Determine whether the issue affects one market, one venue or all valuation paths.
4. Preserve provider status, request identifiers, timestamps and gap classification.
5. Repair only from an approved reproducible source.
6. Require fresh contiguous data, current universe eligibility and account reconciliation before new decisions.
7. Treat a suspension, delisting or abnormal spread/depth event as a universe/risk event, not merely a transient API error.

## Playbook E — Cloudflare, D1 or deployment failure

1. Disable schedules or the production Worker through the trusted provider control plane.
2. Revoke private credentials if deployment integrity is uncertain.
3. Record the last trusted commit, deployment and D1 backup digest.
4. Export the current database before restoration when safe.
5. Restore only to an isolated environment first and verify immutable digests.
6. Reconcile restored state with the exchange.
7. Deploy the exact reviewed commit; do not mix emergency edits with unrelated changes.
8. Complete paper then shadow verification before requesting live recovery.

## Playbook F — repository or dependency compromise

1. Stop deployments and scheduled execution.
2. Revoke GitHub tokens, Cloudflare deployment credentials and affected exchange keys.
3. Identify the last trusted signed/reviewed commit and lockfile.
4. Review commits, branches, workflows, collaborators, releases and deployment provenance.
5. Remove malicious changes through a reviewed forward fix.
6. Rebuild and validate in isolation.
7. Complete independent security review and recovery gates.

## Communications and evidence

Incident records contain no secrets. Record:

- incident identifier, owner, severity and status;
- UTC and Australia/Brisbane timestamps;
- affected environment, provider and approved capital;
- last trusted commit/deployment and strategy configuration;
- redacted request, order, fill and permission identifiers;
- evidence and export SHA-256 digests;
- containment, reconciliation and recovery decisions;
- client approvals;
- corrective actions, owners and deadlines.

Notify the user immediately for SEV-1, before any live restoration, and whenever actual capital, account control, tax records or provider terms may be affected.

## Recovery gates

Live operation remains disabled until all applicable items are complete:

- incident contained and affected credentials revoked;
- actual balances, orders, fills, fees and ledgers reconciled with zero unexplained drift;
- root cause identified or the affected capability removed;
- corrective change reviewed and exact-head validation green;
- immutable audit and tax records complete;
- backup/restore and alert paths verified where relevant;
- replacement key proven minimum-permission in shadow mode;
- paper and shadow regression/failure-injection evidence complete;
- no unresolved high-severity issue;
- user explicitly approves live recovery and the maximum capital remains unchanged.

Recovery approval does not approve a capital increase, new venue, broader key or different strategy.

## Post-incident review

Within seven days of containment:

1. Produce a blameless timeline and root-cause analysis.
2. Identify detection and containment delays.
3. Add tests, monitoring and documentation for each corrective action.
4. Reassess severity, data retention, provider suitability and permission boundaries.
5. Record the decision in the decision log when architecture, security, risk or venue policy changes.
6. Schedule and later record a repeat drill proving the correction.
