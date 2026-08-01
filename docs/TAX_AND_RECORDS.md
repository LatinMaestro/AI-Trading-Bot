# Australian tax and record requirements

The application is not tax advice. A registered Australian tax professional must review the treatment before live activation and at tax time.

The Australian Taxation Office states that records are required for each crypto asset and every transaction, including dates, purpose/counterparty, exchange records and Australian-dollar value at the time. Records generally need to be kept for five years from the later relevant record, transaction or CGT-event date.

The system therefore records:

- canonical UTC timestamp, matching Australian local date and validated Australian IANA time zone;
- asset and quantity;
- AUD market value, fee and valuation provenance;
- order, fill and exchange identifiers;
- purpose, counterparty and factual ownership-change status;
- reciprocal paired acquisition/disposal records for crypto-to-crypto exchanges;
- raw source and valuation payload digests;
- explicit acquisition-to-disposal lot allocations;
- transfers and adjustments entered by the user; and
- records needed to reproduce provisional gains, losses, income and expenses.

Exports include deterministic human-readable CSV files, canonical machine-readable data, Australian financial-year summaries and a SHA-256 digest over the complete bundle.

The system does not automatically choose tax lots, tax treatment, CGT discounts, exemptions, loss application or capital-versus-revenue classification. These remain professional-review decisions.

Raw exchange records are retained where provider terms and storage policy permit.

See `docs/TAX_EXPORTS.md`.

Official source: https://www.ato.gov.au/individuals-and-families/investments-and-assets/crypto-asset-investments/keeping-crypto-records
