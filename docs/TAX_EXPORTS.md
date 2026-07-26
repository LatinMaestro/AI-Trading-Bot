# Australian crypto tax-record exports

## Scope

`src/tax/export.ts` defines deterministic transaction records, explicit lot allocations and content-addressed CSV/JSON export bundles for Australian record keeping.

It is a record and arithmetic layer, not tax advice. It does not choose a tax treatment, lot-selection method, CGT discount, business/investor status, loss application or tax return position.

## Transaction record v1

Each record preserves:

- UTC timestamp, Australian local date and configured Australian time zone;
- venue, account and exchange identifiers;
- asset, quantity, AUD value and AUD fee;
- purpose and counterparty reference;
- factual ownership-change status;
- valuation source and valuation payload digest;
- raw source payload digest;
- optional paired record for crypto-to-crypto exchanges;
- optional transaction hash and notes.

Supported factual event kinds are acquisition, disposal, fee disposal, transfer, income, expense and adjustment.

## Explicit lot allocations

The exporter never selects lots automatically. Each disposal must be fully linked to explicit acquisition records through a versioned `selectionReference`.

Controls:

- acquisition and disposal assets must match;
- acquisitions cannot post-date disposals;
- acquisition and disposal quantities cannot be over-allocated;
- every disposal and crypto fee disposal must be fully allocated;
- proportional acquisition value, acquisition fee, disposal proceeds and disposal fee are calculated in AUD;
- results are grouped by Australian financial year.

The worksheet does not apply CGT discounts, exemptions, carried losses or income-tax classifications.

## Export bundle

`buildTaxExportBundle` produces:

- `transactions.csv`;
- `cgt-allocations.csv`;
- `financial-year-summary.csv`;
- canonical machine-readable records and summaries; and
- a SHA-256 digest over the complete canonical bundle.

Text cells that could trigger spreadsheet formulas are neutralised before CSV output.

The digest proves export content identity only. It does not prove tax correctness, professional review or filing approval.

## Record-keeping boundary

The Australian Taxation Office requires records for each crypto asset and every transaction, including transaction dates, purpose/counterparty, exchange records and AUD value at the time. Records generally need to be retained for five years from the later relevant record, transaction or CGT-event date.

Before live activation and tax filing, a registered Australian tax professional must review:

- event classification;
- ownership-change treatment for transfers;
- lot-selection policy;
- fee treatment;
- capital versus revenue treatment;
- discounts, exemptions and losses; and
- final export completeness.

Official source: https://www.ato.gov.au/individuals-and-families/investments-and-assets/crypto-asset-investments/keeping-crypto-records
