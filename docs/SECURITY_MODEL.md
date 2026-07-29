# Security model

## Threats addressed

- leaked exchange credentials;
- a compromised repository or dependency;
- malicious or defective strategy output;
- duplicate scheduled runs;
- replayed or ambiguous API requests;
- provider outage or stale market data;
- unauthorised live activation;
- hidden withdrawal or funding permissions;
- audit-log deletion or inconsistency.

## Operational runbooks

- `docs/SECURITY_OPERATIONS_RUNBOOK.md` defines credential inventory, provisioning, permission verification, quarterly rotation, suspected-exposure response, backup evidence and drill records.
- `docs/INCIDENT_RESPONSE_RUNBOOK.md` defines severity, immediate containment, exchange-authoritative reconciliation, scenario playbooks and live-recovery gates.
- Any operator may stop automation or revoke access. Only the user may restore live operation.
- SEV-1 and SEV-2 events disable scheduled live execution. Uncertain severity is escalated.
- Incident records contain redacted identifiers and evidence digests, never secrets or unredacted private responses.

## Credential rules

- Exchange credentials are Cloudflare secrets, never repository variables.
- The user enters secrets directly into Cloudflare; they are never pasted into chat, issues or pull requests.
- The bot accepts no seed phrase, wallet private key, exchange password or 2FA recovery code.
- A live-capable key may have only the minimum permissions required to query balances and manage spot orders.
- The application calls the venue's key-info endpoint and fails closed if it detects withdrawal, withdrawal-address, deposit/funding, earn or other unapproved permissions.
- Credentials are rotated after any suspected exposure and on the periodic schedule defined in operations documentation.

## Capability exclusions

Source and CI checks reject:

- withdrawal or transfer endpoints;
- leverage or margin parameters;
- futures, perpetuals and derivatives modules;
- wallet-signing libraries and seed-phrase handling;
- hard-coded API keys, private keys or activation secrets.

## Live activation

Live execution requires all of:

1. `TRADING_MODE=live` in non-secret configuration.
2. `LIVE_TRADING_ENABLED=true`.
3. A secret activation value whose SHA-256 digest matches the configured approved digest.
4. A completed activation record in D1.
5. A strategy version approved for live use.
6. Fresh market and account data.
7. Safe API permissions verified during the current cycle.
8. No active kill switch or unresolved reconciliation error.
9. The order is within all hard risk and venue limits.

Any missing, malformed or ambiguous state means no order.

Signed strategy configurations and external authorisation statements use public-key-only P-256 verification and must match independently reviewed key IDs and public-key digests. They retain no private signing material and are content-bound to exact research evidence. Verification alone grants no execution authority and cannot satisfy the separate activation secret, D1 activation record, live flags, permission checks, freshness checks, reconciliation state or hard risk limits.

## Supply-chain controls

- Minimise runtime dependencies.
- Pin GitHub Actions to major versions initially and move to commit SHAs during hardening.
- Run dependency review and secret scanning.
- Review lockfile changes as code.
- Do not use unverified trading-bot packages or copied strategy code.
