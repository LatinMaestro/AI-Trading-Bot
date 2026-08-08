# External-intelligence backtest replay

## Scope

This slice turns persisted external-intelligence artifacts into deterministic,
content-addressed hourly replay frames. It exists to measure research outcomes
without using evidence before it was actually available.

The replay layer does not fetch sources, infer trades, change strategy signals,
place orders, deploy infrastructure or activate capital. External intelligence
remains subordinate to market-data, liquidity, impact, strategy, signed-policy
and risk gates.

## Complete snapshot contract

Each input snapshot is a complete effective intelligence state at one
assessment time. It binds:

- one correction-effective linkage artifact and its linkage time;
- one manipulation-evidence artifact and its analysis time;
- zero or more integrated assessments made at the snapshot time; and
- exact content-addressed identities for every artifact.

Snapshot assessment times must be unique. Input order is irrelevant. At an
hourly decision time, replay selects only the latest complete snapshot whose
assessment time is no later than that decision. A later snapshot therefore
cannot rewrite an earlier frame, while a later correction or retraction can
replace the complete effective state from that point forward.

Before use, replay re-verifies every artifact digest, every provenance edge and the exact cross-artifact partition between linkage and manipulation evidence.
Publication must be no later than receipt, receipt no later than availability,
availability no later than linkage, linkage no later than manipulation
analysis, and analysis no later than assessment. Invalid chronology, changed
digests, cross-snapshot integrations, duplicate snapshot times, non-hourly
signals and unbounded inputs fail closed.

## Reaction lifetime and gates

The replay policy content-addresses a maximum age for every reaction and a
maximum snapshot count. At each decision it separates active and expired
integrations.

- Active `pause-new-risk` evidence blocks only `new-risk` and `increase-risk`
  intents.
- `reduce-risk`, `exit` and `hold` remain allowed during a pause.
- Active `research-candidate` evidence is surfaced for measurement only and
  never authorises or increases exposure.
- `watch` and `ignore` remain non-actionable.

The initial paper boundary uses a one-hour maximum age for
`pause-new-risk`. Research runs must version every replay age rather than
silently inheriting a current value.

## Latency evidence

Every selected frame records:

- earliest publication time;
- latest receipt time;
- latest availability time;
- maximum publication-to-receipt delay;
- maximum receipt-to-availability delay;
- maximum availability-to-assessment delay; and
- maximum publication-to-assessment delay.

These measurements distinguish publisher delay, transport delay, processing
delay and assessment delay. Missing or delayed evidence cannot be presented as
zero-latency information.

## Execution-aware comparison

The execution-aware boundary accepts the complete replay source input and
rebuilds it before use. It does not accept caller-authored per-step pause flags.
Every backtest step must have exactly one rebuilt frame whose decision time
equals the step signal time.

A fresh pause removes only buy requests, before fee, fill, capacity and impact
modelling. Sells remain executable, including reductions and exits following
earlier partial fills. Every suppression records the exact frame, pause
evidence, requested AUD notional, signal time and execution time. Suppression
is distinct from a market miss and never becomes a simulated fill.

The same configuration and steps run once without intelligence and once with
the verified gate. The comparison independently content-addresses both complete
results and then binds those result identities with equity and return deltas,
suppression counts and notional, and pause and research-candidate frame counts.
Research candidates remain observational and cannot change targets or create
requests.

## Immutable comparison persistence

Persistence does not accept a replay artifact as sufficient proof. It receives
the complete replay source input, execution configuration and steps, rebuilds
both results and requires exact canonical equality with the supplied comparison
before preparing any D1 statement. This removes stale or caller-forged replay,
frame, suppression and derived-metric surfaces from the storage boundary.

The compact manifest stores the comparison, replay and independent result
digests, final equity and return metrics, suppression totals, observed frame
counts, latest execution time and persistence time. Application and D1 checks
require persistence no earlier than the final execution. Exact retries preserve
the first persistence time; changed identity reuse conflicts, and update or
delete operations fail closed. The manifest proves reproducible research
identity only and grants no strategy approval.

## Reproducibility

Each snapshot, policy, frame, complete replay and comparison has a canonical
SHA-256 identity. Standalone replay verification checks structure, chronology,
partitions, declared snapshot membership and digest identity. The execution
boundary additionally rebuilds the replay from the complete linkage,
manipulation and integrated-assessment source artifacts before any request can
be suppressed.

This remains research evidence only. Synthetic fixtures prove binding and
execution invariants, not profitability. Authoritative market data, calibrated
costs, walk-forward and final-holdout evaluation, authoritative population and
every strategy review gate remain required. No runtime or order authority is added.
