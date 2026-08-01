# Venue research

Research reviewed on 26 July 2026. Fees and service terms can change and must be rechecked before live activation.

## Decision summary

### Kraken — primary implementation

Advantages:

- available to Australian clients with AUD deposits and withdrawals;
- mature public and private APIs;
- explicit per-key permissions for querying funds, modifying/cancelling orders and withdrawing funds;
- the key can be created without withdrawal permission;
- API key information can be queried programmatically, allowing the bot to reject unsafe permissions;
- good public OHLC and order-book data.

Disadvantages:

- entry-tier Kraken Pro spot fees are materially higher than the lowest-cost Australian alternatives;
- the strategy must favour maker orders and low turnover.

### CoinSpot — secondary candidate

Advantages:

- Australian platform;
- market-order fee advertised at 0.1%;
- official trading API;
- withdrawal API functions are documented as requiring separate enablement.

Open items before implementation:

- verify in the live account UI that a trade-capable API key can be created with all withdrawal functions disabled;
- confirm API terms permit the intended unattended trading use;
- confirm sufficient historical market data or define a safe independent data source;
- test order idempotency and reconciliation behaviour.

### CoinJar Exchange — excluded from unattended live execution

CoinJar Exchange has attractive fees, including 0.1% entry-tier crypto/AUD trading and zero maker fees on certain crypto-to-crypto or stablecoin pairs. However, its API security documentation states that each API key has full control of the Exchange account, including transfers. That violates the project's requirement that the bot cannot withdraw or transfer capital.

### DeFi / MetaMask — excluded

A DEX bot would need wallet signing authority and would add smart-contract, malicious-token, bridge, gas, MEV and chain-reorganisation risks. The user's existing ETH on Polygon remains outside the bot. Any movement to a centralised exchange is a separate user-controlled action after the destination network is confirmed in the exchange interface.

## Current source links

- Kraken API key permissions: https://support.kraken.com/articles/360000919966-how-to-create-an-api-key
- Kraken key introspection: https://docs.kraken.com/api/docs/rest-api/get-api-key-info
- Kraken spot fee schedule: https://www.kraken.com/features/fee-schedule
- Kraken AUD funding: https://support.kraken.com/en-au/articles/360045033651-aud-bank-transfers-with-osko-and-payid
- CoinSpot fees: https://www.coinspot.com.au/fees
- CoinSpot API: https://www.coinspot.com.au/v2/api
- CoinJar Exchange fees: https://www.coinjar.com/au/exchange
- CoinJar API security: https://docs.exchange.coinjar.com/docs/security
