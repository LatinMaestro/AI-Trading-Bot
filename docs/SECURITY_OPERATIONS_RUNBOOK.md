# Security operations runbook

## Purpose

This runbook controls credential provisioning, verification, rotation, revocation, evidence retention and security drills. It does not authorise live trading. A missing, failed or ambiguous check keeps the system in research, paper or shadow mode.

## Roles and authority

- The user alone controls the exchange account, Cloudflare account, GitHub account, deposits, withdrawals, live activation and capital increases.
- The application may use only an explicitly approved exchange key restricted to balance reads and spot-order management.
- Repository work never receives or records an exchange password, 2FA code, seed phrase, wallet private key, unrestricted API key or activation value.
- Any authorised responder may disable automation. Provider-side credential revocation is performed by the owner or provider support. Re-enabling live operation remains an owner-only gate.

## Credential inventory

Maintain a non-secret inventory containing only:

- provider and environment;
- credential identifier or final four display characters, never the secret;
- approved permissions;
- creation, verification, last-rotation and expiry dates;
- owner and revocation procedure;
- linked approval record;
- evidence digest for the last permission check.

Do not copy private API responses into tickets or logs. Redact authentication headers, signatures, nonces, cookies, account identifiers and private payloads before retaining evidence.

## Provisioning

1. Complete provider KYC and terms outside the repository.
2. Enable strong unique-password and phishing-resistant 2FA controls where available.
3. Create a dedicated API key, not a reused personal or administrative key.
4. Permit only required balance/account reads and spot-order create, query, modify or cancel operations.
5. Exclude withdrawals, transfers, withdrawal-address management, deposits/funding, earn, staking, margin and derivatives.
6. Restrict IP, expiry and environment where the venue supports it.
7. Enter secrets directly into Cloudflare secrets. Never paste them into chat, GitHub, logs, screenshots or test fixtures.
8. Record only the non-secret inventory fields and approval reference.
9. Run the venue permission-introspection check in shadow mode.
10. Fail closed if the reported permission set is absent, incomplete, broader than approved or cannot be verified.

## Pre-live verification

Immediately before every private cycle and again before order submission:

- verify runtime mode and activation gates;
- verify the key fingerprint matches the approved inventory entry;
- retrieve current venue permissions;
- reject any funding, withdrawal, address-management, earn, margin or derivative permission;
- require fresh balances, orders and reconciliation state;
- require no active kill switch or unresolved security incident;
- record a redacted permission-check digest and timestamp.

A provider that cannot prove the safe permission boundary is not eligible for unattended live execution.

## Routine operation

- Review permission evidence and security alerts daily while live.
- Reconcile exchange orders, fills, fees and balances daily.
- Review Cloudflare, GitHub and exchange account access monthly.
- Rotate live-capable credentials at least quarterly.
- Recheck provider permission semantics, Australian availability and API behaviour before each rotation.
- Test exchange-side revocation, schedule disablement, backup export and alert delivery at least quarterly without placing an order.
- Remove obsolete credentials immediately; do not retain dormant live-capable keys.

## Planned rotation

1. Return the system to shadow or paper mode and activate the kill switch.
2. Wait for any known in-flight private request to settle.
3. Reconcile balances, open orders, fills and tax/audit records.
4. Create a replacement key with the approved minimum permissions.
5. Enter the replacement directly into Cloudflare.
6. Verify its fingerprint and permission evidence in shadow mode.
7. Revoke the old key at the exchange.
8. Prove the old key can no longer authenticate.
9. Update the non-secret inventory and record evidence digests.
10. Resume live operation only through the recovery gates in the incident runbook.

Rotation never changes the approved strategy, capital limit or live authority.

## Suspected exposure

Treat any secret in chat, source, a commit, issue, pull request, log, screenshot or untrusted machine as compromised even if later deleted.

1. Activate the kill switch and disable scheduled execution.
2. Revoke the exchange key at the exchange; do not wait for code changes.
3. Cancel unexpected open orders through the exchange interface.
4. Preserve redacted timestamps, commit identifiers, request IDs and audit digests.
5. Rotate the affected Cloudflare, GitHub, alerting and exchange credentials from a trusted device.
6. Review balances, ledgers, open/closed orders, logins, sessions and account-permission changes.
7. Start the appropriate incident playbook.
8. Purge exposed material from active systems only after evidence is preserved. Repository-history rewriting requires explicit review and does not make a leaked key safe.
9. Keep live trading disabled until containment, reconciliation, root-cause review and recovery approval are complete.

## Supply-chain event

For a compromised dependency, action, repository token or deployment:

- stop deployments and scheduled execution;
- revoke affected credentials and sessions;
- identify the last trusted commit, lockfile and deployment;
- compare produced artifacts with expected digests;
- remove or pin the affected component;
- rebuild from the trusted source in an isolated environment;
- complete independent review before restoring private access.

Do not roll back D1 blindly. Preserve immutable audit, market, universe and tax evidence; use a reviewed forward recovery or verified backup restoration.

## Backup and recovery evidence

Before canary activation, prove:

- D1 export and restoration to an isolated environment;
- immutable-record digests remain identical after restoration;
- Cloudflare configuration can be reconstructed without exporting secret values;
- exchange orders, fills and balances can be re-imported and reconciled;
- alert and kill-switch paths work when the primary deployment is unavailable.

Backup exports are sensitive. Encrypt them, restrict access, record digests and retention, and never commit them to GitHub.

## Required drill record

Each drill records:

- scenario, scope and severity;
- start, detection, containment and recovery timestamps;
- participants and decision owner;
- affected provider and environment;
- redacted evidence digests;
- actions taken and failed actions;
- reconciliation result;
- root cause and corrective work;
- recovery approver;
- follow-up owner and due date.

A checklist completion without recorded evidence does not satisfy an activation gate.
