# Venue research

Research re-verified against the linked official sources on 1 August 2026. Fees, supported assets, API scopes and service terms can change and must be rechecked before implementation and live activation.

## Decision summary

### Kraken — primary foundation implementation

Advantages:

- available to Australian clients with AUD deposits and withdrawals;
- mature public and private APIs;
- explicit per-key permissions for querying funds, modifying/cancelling orders and withdrawing funds;
- the key can be created without withdrawal permission;
- API key information can be queried programmatically, allowing the bot to reject unsafe permissions;
- broad spot-market access and useful public OHLC/order-book data.

Disadvantages:

- entry-tier spot fees may be higher than lower-cost Australian alternatives;
- not every asset has a direct AUD pair, so a broad universe needs explicit quote-conversion and Australian-dollar valuation handling;
- historical REST OHLC depth is limited and cannot alone support survivorship-safe broad research.

Kraken remains the foundation adapter because its permission model and introspection are already represented in the repository. That does not make it the permanent exclusive venue.

### CoinJar Exchange — priority comparison candidate

Current official CoinJar support documentation describes three API scopes:

- `readonly` for GET access;
- `trades` for trade read access and placing/cancelling orders;
- `allaccess` for the above plus account, API-key and transfer management.

This corrects the earlier assumption that every CoinJar key necessarily has transfer authority. A live-capable integration may be considered only with the `trades` scope and only after confirming through current documentation, account UI and safe validation that it supplies every required balance, order, fill and reconciliation read while excluding all transfer-capable functions.

Advantages:

- Australian platform and account verification path;
- more than 380 advertised AUD, USD, GBP and BTC trading pairs at the review date;
- entry-tier fiat-pair maker/taker fee advertised at 0.10%;
- crypto-to-crypto and crypto-to-stablecoin fees advertised at 0.00% maker and 0.06% taker;
- potentially valuable for a high-turnover, market-cap-agnostic strategy if liquidity and API reconciliation are sufficient.

Open items before adapter implementation:

- prove the `trades` scope cannot manage transfers, withdrawal addresses or API keys;
- confirm required balances, orders, fills and fee invoices are accessible under that scope;
- confirm API terms permit unattended trading;
- compare actual depth, spreads, minimums and price impact rather than advertised pair count alone;
- establish time-appropriate listing/delisting history and research-grade market data;
- test idempotency, post-only behaviour, taker behaviour, partial fills and ambiguous-response recovery;
- confirm fee invoicing cannot create a negative balance when the bot retains its configured reserve.

### CoinSpot — secondary comparison candidate

Advantages:

- Australian platform;
- market-order fee advertised at 0.1%;
- official trading API;
- withdrawal API functions are documented as requiring separate enablement.

Open items before implementation:

- verify in the live account UI that a trade-capable API key can be created with all withdrawal functions disabled;
- confirm API terms permit the intended unattended trading use;
- confirm sufficient historical market data or define a safe independent data source;
- test order idempotency and reconciliation behaviour;
- compare actual venue-wide spot coverage, liquidity and execution cost with Kraken and CoinJar.

### DeFi / MetaMask — excluded

A DEX bot would need wallet signing authority and would add smart-contract, malicious-token, bridge, gas, MEV and chain-reorganisation risks. The user's existing ETH on Polygon remains outside the bot. Any movement to a centralised exchange is a separate user-controlled action after the destination network is confirmed in the exchange interface.

## Venue-selection rule

Venue selection must use current evidence for:

- Australian availability and terms;
- scope-restricted credentials with no transfer or withdrawal authority;
- programmatic permission verification where available;
- eligible asset universe and historical membership data;
- maker/taker fees, fee invoicing, spread, depth, fill quality and order minimums;
- API reliability, idempotency and reconciliation;
- AUD deposits/withdrawals and complete Australian-dollar tax records;
- ease of user-controlled withdrawal after the objective or at any earlier time.

A lower headline fee does not override credential or reconciliation safety. A mature venue does not override materially inferior after-cost opportunity if a safer scoped alternative is proven.

## Current source links

- Kraken API key permissions: https://support.kraken.com/articles/360000919966-how-to-create-an-api-key
- Kraken key introspection: https://docs.kraken.com/api/docs/rest-api/get-api-key-info
- Kraken spot markets: https://support.kraken.com/articles/kraken-markets
- Kraken spot fee schedule: https://www.kraken.com/features/fee-schedule
- Kraken AUD funding: https://support.kraken.com/en-au/articles/360045033651-aud-bank-transfers-with-osko-and-payid
- CoinSpot fees: https://www.coinspot.com.au/fees
- CoinSpot API: https://www.coinspot.com.au/v2/api
- CoinJar Exchange: https://www.coinjar.com/au/exchange
- CoinJar fees: https://www.coinjar.com/global/fees
- CoinJar API scopes: https://support.coinjar.com/hc/en-au/articles/900001966206-CoinJar-Exchange-API