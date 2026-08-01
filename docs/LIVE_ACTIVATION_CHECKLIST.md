# Live activation checklist

All items must be complete. A missing or uncertain item means live trading remains disabled.

## User and provider

- [ ] User has reviewed that the full allocation can be lost.
- [ ] User has obtained any desired tax/accounting advice.
- [ ] Exchange account KYC and terms are complete.
- [ ] Current fee schedule and Australian availability have been rechecked.
- [ ] The approved canary amount is recorded.

## Credentials

- [ ] Key can query funds.
- [ ] Key can query open and closed spot orders.
- [ ] Key can create/modify and cancel spot orders.
- [ ] Withdraw-funds permission is absent.
- [ ] Add/update withdrawal-address permissions are absent.
- [ ] Deposit/funding and earn permissions are absent.
- [ ] Key-info endpoint confirms the approved permission set.
- [ ] Secrets were entered directly into Cloudflare.
- [ ] Account password and funding withdrawals have strong 2FA.

## Technical evidence

- [ ] Exact-head CI is green.
- [ ] Independent security review is complete.
- [ ] Required paper and shadow evidence is complete.
- [ ] Reconciliation has no unresolved drift.
- [ ] Failure-injection tests pass.
- [ ] Strategy version and risk configuration are approved.
- [ ] D1 backup/export procedure is tested.
- [ ] Alerts and exchange-side kill procedure are tested.
- [ ] Credential-revocation, schedule-disable and backup-restore drills have recorded evidence.
- [ ] Security and incident runbooks have named owners and current provider procedures.
- [ ] No unresolved SEV-1 or SEV-2 incident remains.
- [ ] Live-recovery authority remains owner-only.

## Activation

- [ ] `TRADING_MODE=live` approved.
- [ ] `LIVE_TRADING_ENABLED=true` approved.
- [ ] Activation secret and digest configured.
- [ ] D1 activation record created with approved maximum capital.
- [ ] First order is validate-only where supported.
- [ ] First executable order is the smallest practical canary.
- [ ] Post-order balances, order state, fill, fee and tax record reconcile.
