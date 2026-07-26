# Agent operating instructions

## Mandatory source of truth

Read these files before changing the repository:

- `CODEX_START_PROMPT.md`
- `README.md`
- `docs/SPECIFICATION_SOURCE_OF_TRUTH.md`
- `docs/MASTER_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/RISK_POLICY.md`
- `docs/REVIEW_GATES.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/DECISION_LOG.md`
- `docs/CURRENT_STATUS.md`

Read the remaining `docs/` files when their subject is relevant.

## Non-negotiable boundaries

1. Spot only. No leverage, margin, futures, options, perpetuals, borrowing, lending, staking or short positions.
2. No transfer or withdrawal code. A venue adapter must reject credentials with any funding or withdrawal permission.
3. No MetaMask integration and no custody of wallet keys.
4. No secrets in source, issues, pull requests, logs, screenshots, test fixtures or documentation.
5. Research, paper and shadow modes precede live mode.
6. Live mode is disabled by default and requires all activation gates.
7. Every decision, signal, order attempt, response, fill, balance change and risk event must be auditable.
8. Australian-dollar valuations and records are mandatory for tax reporting.
9. A strategy may not advance because of headline returns alone. It must pass out-of-sample, walk-forward, fee, slippage, drawdown and stability tests.
10. The US$1 million objective is aspirational, not a guarantee or permission to bypass controls.

## Pull-request discipline

- Use small branches named `agent/<description>`.
- Keep each pull request focused on one plan item.
- Do not merge with failing or missing required checks.
- Review the exact head SHA before merge.
- Prefer squash merge.
- Record material architecture, security, risk and venue changes in `docs/DECISION_LOG.md`.
- Never weaken a safety gate merely to make a test or deployment pass.

## Required validation

At minimum:

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npm run deploy:dry
npm run check:forbidden
```

Run additional backtests, migration checks and security tests when relevant.

## Client-only stop conditions

Stop with a precise instruction only when the next unblocked action requires the user to:

- complete KYC or accept provider terms;
- choose or pay for a provider;
- enter scoped secrets directly into Cloudflare;
- deposit or withdraw funds;
- approve live activation or a capital increase;
- obtain professional tax, accounting or legal advice;
- perform an action that cannot be completed through the connected hosted tools.
