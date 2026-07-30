# Hourly trend/breakout research candidate

## Status

`hourly-trend-breakout-v0.1.0` is a deterministic research candidate. It is not a selected, promoted, paper-active or live-capable strategy. The existing daily momentum implementation remains the runtime regression baseline until comparative research and every promotion gate pass.

## Baseline policy

- committed 60-minute candles only;
- 168-hour prior Donchian entry channel;
- 72-hour prior Donchian exit channel;
- 200-hour exponential moving average;
- positive 168-hour close-to-close momentum;
- 90% target exposure with the balance remaining in AUD;
- no more than one open directional asset;
- no same-candle rotation after an exit.

Every channel excludes the current closed signal candle. An entry requires the latest close to exceed the prior entry high, remain above the EMA and have positive momentum. Among simultaneous entrants, the highest sum of breakout strength, EMA distance and momentum wins, with canonical pair order breaking exact ties.

An existing position is retained while it remains above its exit channel, EMA and momentum gates. A breach returns the target to AUD cash for that signal; another asset cannot replace it until a later signal. This intentionally creates a low-turnover regression candidate rather than assuming rapid rotation improves after-cost results.

Every decision carries an immutable copy of the exact policy values used, so parameter variants cannot share a strategy version without retaining their complete configuration evidence.

All pair histories must be internally contiguous, bounded to the approved research horizon and close at the same hourly decision timestamp. Candle timestamps identify interval opens, so the bound decision time is exactly one hour after the final committed candle timestamp. Every signal and decision carries that closed-hour timestamp; mixed-time rankings fail closed.

## Universe-bound execution-aware backtest

Research plans bind every decision to one independently verified, content-addressed signal-time universe membership artifact. Both configured BTC/AUD and ETH/AUD histories must remain valid even when one pair is ineligible, preventing malformed excluded data from bypassing evidence checks. Entries are evaluated only across the configured pairs present in exact eligible membership; no eligible pair produces an explicit AUD-cash decision, while a held pair that loses eligibility produces an exit without same-signal rotation.

Each bound decision retains the exact policy, snapshot, signed-policy and membership identities plus the prior target. Complete decisions and the entire plan are content-addressed and independently re-verified before the existing execution-aware engine models fees, spread, slippage, adverse selection, participation, price impact and missed fills. This is research orchestration only and does not promote or connect the candidate to runtime selection.

## Research boundary

The policy values are versioned hypotheses, not evidence of profitability. Before promotion, this candidate requires:

- exact signal-time universe membership;
- research-grade historical hourly candles;
- walk-forward and untouched final-holdout evaluation;
- fee, spread, slippage, missed-fill and price-impact calibration;
- parameter sensitivity across entry, exit, EMA and momentum windows;
- AUD cash, BTC hold, equal-weight and five-year objective benchmarks;
- drawdown, terminal wealth, target-attainment and ruin-risk analysis;
- capacity tests from the initial allocation through the objective path;
- a persisted research report and separately authorised signed configuration.

Each completed candidate evaluation is bound into one reproducible research-run envelope containing the exact plan, execution assumptions and complete result identities. Verification re-runs the universe-bound execution-aware backtest and rejects any changed plan, configuration, result or outer digest. D1 retains only the immutable compact run manifest; research reports reference sorted unique run digests.

Walk-forward evidence binds contiguous fold indexes, increasing training cutoffs, disjoint later validation windows and one strictly later final holdout. Every underlying run is re-verified and may appear only once. Parameter sensitivity compares unique same-period policies under one execution configuration, requires the baseline exactly once and sorts variants by policy digest. Neither manifest ranks, selects or promotes a policy.

Persistence re-verifies the full manifest, requires every component run to exist in the immutable research-run ledger, writes the canonical manifest and ordered run memberships atomically, and reads the complete row set back before success. Research reports bind sorted unique evaluation-manifest digests. These identities remain evidence references only.

Complete-evaluation orchestration independently re-verifies both manifest identities and the exact shared baseline final-holdout run. The report strategy series must equal the reproduced after-cost equity curve and bind its run/result digests; provenance must contain exactly every walk-forward, holdout and sensitivity run plus both evaluation manifests. All four mandatory benchmarks, objective progress, target-attainment/ruin analysis and explicit aspirational-objective, complete-loss and non-promotion warnings are required before one final envelope is content-addressed. The envelope contains no ranking, selection, promotion or runtime activation state.
Persistence reproduces the complete evaluation again, then stores the canonical report in bounded content-addressed UTF-8 chunks so a five-year hourly report does not depend on one oversized D1 row. A database commit marker requires exact chunk and byte totals before the compact evaluation binding can reference the report. Read-back reconstructs and re-hashes the exact report; conflicts, incomplete evidence, mutation and deletion fail closed. Persistence does not imply ranking, selection, promotion or approval.

Execution-stress evidence requires one reviewed finite-validity calibration artifact bound to the exact final-holdout plan/run and sorted source digests. A fixed, non-cherry-pickable matrix evaluates A$200, A$1,000, A$10,000, A$100,000 and A$1,000,000 under baseline, all-maker, all-taker, doubled-spread, quarter-liquidity, quarter-maker-fill, doubled-taker-slippage and severe-combined assumptions. Every transformed configuration, step set and result is content-addressed; the A$200 baseline must reproduce the final holdout exactly. Missed-fill ratios and constrained executions are surfaced, while the artifact hard-codes the candidate as unselected research-only and contains no ranking or promotion field.

Calibration and all 40 stress outcomes are persisted as canonical immutable JSON only after the exact baseline research run is present. The database enforces calibration availability/validity, exact plan/run/result agreement, fixed matrix cardinality and one immutable complete-evaluation binding. The research report must include the stress-manifest digest alongside walk-forward and sensitivity identities; its generation time cannot predate the stress evidence. A mandatory warning states that capacity stress does not prove live fillability.

A deterministic readiness assessment enumerates the fixed Gate B–E evidence required for research review and later promotion. It derives missing, partial, non-authoritative, stale, evidence-present and external-review-required outcomes from bounded content-addressed references. Synthetic fixtures cannot satisfy authoritative gates; selection, ranking, approval and runtime authority are structurally absent.

Readiness evidence inputs and derived assessments are persisted as immutable canonical JSON with ordered gate memberships and database read-back verification. Evidence-present complete-evaluation, live-like calibration and capacity-stress gates bind to exact already-committed identities with chronology and cross-artifact consistency enforced in D1; incomplete gate sets, conflicts, mutation and deletion fail closed.

A public-key-only P-256 contract requires an independently reviewed key ID and public-key digest trust anchor before it can verify an exact, expiring strategy configuration bound to the strategy policy, signed universe policy, risk policy, complete evaluation and readiness assessment. A separate externally signed authorisation statement binds its scope, reviewed capital and mandatory loss/objective/permission acknowledgements to that exact configuration. Both artifacts explicitly carry no standalone execution authority, retain no private signing material and cannot replace the separate activation checklist, runtime gates or owner-controlled live activation.

Verified signed configurations and external authorisation statements are persisted only after the exact research-complete readiness assessment and complete evaluation are committed. Content digest and human-readable version/ID reuse are protected independently; exact retries are idempotent, while chronology drift, evidence drift, conflicts, updates and deletion fail closed. Persisted scope remains non-executable and cannot activate the candidate.

Configuration and external-authorisation public keys are admitted only through separate finite-validity trust roles with content-addressed review evidence. Immutable rotation lineage and effective revocations are checked in both application code and D1 before persistence; expiry, role drift, key aliasing, identity rebinding or an omitted known revocation fails closed. Trust evidence itself grants no execution authority.

Point-in-time loading is digest-selected rather than latest-record-selected. At the explicit decision time it re-verifies the signed envelope, active role-scoped trust and any then-known revocation, configuration and finite readiness validity, all 12 ordered readiness gates, the exact complete-evaluation/calibration/stress bindings and the bounded committed report identity. The content-addressed result remains unselected and non-executable.

Persistence always repeats that verification, then stores one immutable compact evidence row. D1 rejects missing or backdated evidence, omitted then-known revocations, effective revocations, changed natural identities, conflicts, updates and deletion. Persistence neither selects the candidate nor consumes external authorisation.

A deterministic review proposal may reference one exact verification identity and one separately signed external authorisation. Proposal construction re-verifies both role-separated trust paths, rejects expired or revoked evidence, mismatched capital/evaluation/readiness bindings and self-authorisation, and content-addresses the mandatory complete-loss, aspirational-objective and non-activation warnings. The candidate remains unselected; the proposal has no selection decision, activation authority or execution authority.

Persistence reloads only those exact digests at the proposal timestamp. Application and D1 both reject missing, late, expired, revoked, role-aliased or rebound evidence; immutable rows retain the complete point-in-time trust state and all non-authority fields. Persistence does not consume the external authorisation or select the candidate.

Review loading accepts only an exact persisted proposal digest and explicit review time. It reconstructs the original proposal, revalidates both signer trust paths, known revocations and configuration/authorisation expiry at review time, then emits a separate content-addressed verification that remains unselected and non-executable.

A signed external review receipt must bind that exact verification digest. Its closed disposition set can only acknowledge the proposal for owner review, defer it or reject it; approval, selection, authorisation consumption, activation and execution authority are structurally absent.

Persistence stores the exact review-time proposal verification and signed receipt as separate immutable records. Application and D1 independently bind proposal, trust, known revocation, chronology, reviewer identity and the closed disposition set; stale evidence, identity reuse, mutation and any authority-bearing state fail closed.

The module produces targets only. It does not submit or approve orders, activate paper/live mode, connect credentials or weaken any market-data, liquidity, intelligence, risk or execution gate.
