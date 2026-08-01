# Review gates

## Gate A — Foundation

- control documents complete and internally consistent;
- no forbidden capability in code;
- typecheck, tests and Wrangler dry-run pass;
- live mode fails closed with missing configuration;
- initial D1 schema is reversible through a forward migration plan.

## Gate B — Research validity

- reproducible data ingestion;
- no look-ahead leakage;
- realistic costs and execution model;
- walk-forward and final holdout results;
- benchmark and parameter-stability evidence;
- strategy configuration signed and versioned.

## Gate C — Paper readiness

- order lifecycle, partial fills and reconciliation tested;
- duplicate schedules and ambiguous exchange responses tested;
- tax and audit exports complete;
- 30 consecutive days without unresolved accounting drift.

## Gate D — Shadow readiness

- private key permissions are verified programmatically every cycle;
- no withdrawal, funding, address-management or earn permission;
- actual balances and orders reconcile without mutation;
- incident alerts and exchange-side kill procedure proven.

## Gate E — Canary activation

- independent security review complete;
- paper/shadow evidence meets the approved observation period;
- no unresolved high-severity issue;
- user approves a specific live amount and activation date;
- activation checklist completed;
- first order uses validate-only where supported and the smallest practical canary.

## Gate F — Capital increase

- minimum live observation period completed;
- after-fee results, drawdown and execution quality reviewed;
- no unexplained drift or security event;
- tax records reconciled;
- user explicitly approves the new maximum capital.

Production live activation and every capital increase remain client-only decisions.
