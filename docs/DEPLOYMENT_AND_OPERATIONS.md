# Deployment and operations

## Hosting

Target: Cloudflare Workers and D1, beginning on the Free plan. The current free allowances are expected to be adequate for low-frequency research and scheduled operation, but usage must be monitored and the current pricing page rechecked before activation.

## Environments

- local/test: synthetic data only;
- preview: paper mode only, no private exchange credentials;
- production research: public data and paper mode;
- production shadow: scoped private read access only;
- production live: explicit activation gate and scoped trade key.

## Secrets

Potential Cloudflare secrets:

- `KRAKEN_API_KEY`
- `KRAKEN_API_SECRET`
- `LIVE_ACTIVATION_VALUE`
- alert-provider secret, only if an approved provider is added later.

Never store these in GitHub. Use `wrangler secret put` or the Cloudflare dashboard directly.

## Required operational controls

- structured logs without credentials or full private payloads;
- health endpoint and latest-cycle status;
- D1 lease preventing overlapping cycles;
- idempotent order intents;
- daily balance and order reconciliation;
- alert on stale data, permission changes, rejected orders, unknown order states, drawdown and failed schedules;
- documented manual exchange-side kill procedure;
- quarterly credential rotation at minimum and immediate rotation after suspected exposure.

## Cost policy

Use free hosted services while limits and reliability are adequate. Do not trade reliability, security or withdrawal safety for lower fees. Any move to a paid plan is a client-only decision.
