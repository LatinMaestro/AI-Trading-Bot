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

Before use, replay re-verifies every artifact digest and provenance edge.
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

## Reproducibility

Each snapshot, policy, frame and complete replay has a canonical SHA-256
identity. The replay output includes the exact selected snapshot, visible
assessments, active pause evidence, research candidates, watch-only evidence,
ignored evidence, expired assessments and latency measurements for every
hourly decision.

This is a research primitive, not evidence of strategy profitability or
approval for live use. A later execution-engine integration must bind each
order intent to its exact replay frame and prove that blocked additions cannot
enter the execution request set.
