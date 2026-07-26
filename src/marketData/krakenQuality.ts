export interface KrakenTickerObservation {
  readonly canonicalPair: string;
  readonly ask: number;
  readonly bid: number;
  readonly last: number;
  readonly baseVolume24h: number;
  readonly vwap24h: number;
  readonly quoteTurnover24h: number;
}

export interface KrakenOrderBookLevel {
  readonly price: number;
  readonly baseVolume: number;
  readonly timestampMs: number;
}

export interface KrakenOrderBook {
  readonly canonicalPair: string;
  readonly asks: readonly KrakenOrderBookLevel[];
  readonly bids: readonly KrakenOrderBookLevel[];
}

export interface KrakenMarketQualitySummary {
  readonly canonicalPair: string;
  readonly spreadBps: number;
  readonly availableQuoteVolume: number;
  readonly estimatedImpactBps: number | null;
  readonly candidateOrderQuote: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeKrakenDisplayPair(value: string): string {
  if (value.trim() !== value || value !== value.toUpperCase()) {
    throw new Error("Kraken pair key must be canonical uppercase text");
  }
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Z0-9.]+$/.test(part))
  ) {
    throw new Error(`Kraken pair key ${value} is not assetVersion=1 format`);
  }
  const [rawBase, rawQuote] = parts;
  if (rawBase === undefined || rawQuote === undefined) {
    throw new Error("Kraken pair key is incomplete");
  }
  const base = rawBase === "XBT" ? "BTC" : rawBase;
  const quote = rawQuote === "XBT" ? "BTC" : rawQuote;
  return `${base}/${quote}`;
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Kraken ${field} must be finite and positive`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Kraken ${field} must be finite and non-negative`);
  }
  return parsed;
}

function arrayNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
  index: number,
  pair: string,
  allowZero = false,
): number {
  const values = record[field];
  if (!Array.isArray(values) || values.length <= index) {
    throw new Error(`Kraken ticker ${pair} has invalid ${field}`);
  }
  return allowZero
    ? nonNegativeNumber(values[index], `ticker ${pair} ${field}[${index}]`)
    : positiveNumber(values[index], `ticker ${pair} ${field}[${index}]`);
}

export function parseKrakenTickers(
  payload: unknown,
): readonly KrakenTickerObservation[] {
  if (!isRecord(payload) || Object.keys(payload).length === 0) {
    throw new Error("Kraken Ticker result must be a non-empty object");
  }
  const observations: KrakenTickerObservation[] = [];
  const identities = new Set<string>();
  for (const [pairKey, raw] of Object.entries(payload)) {
    if (!isRecord(raw)) {
      throw new Error(`Kraken ticker ${pairKey} must be an object`);
    }
    const pair = normalizeKrakenDisplayPair(pairKey);
    if (identities.has(pair)) {
      throw new Error(`Kraken Ticker returned duplicate pair ${pair}`);
    }
    identities.add(pair);
    const ask = arrayNumber(raw, "a", 0, pair);
    const bid = arrayNumber(raw, "b", 0, pair);
    const last = arrayNumber(raw, "c", 0, pair);
    const baseVolume24h = arrayNumber(raw, "v", 1, pair, true);
    const vwap24h = arrayNumber(raw, "p", 1, pair);
    if (ask < bid) {
      throw new Error(`Kraken ticker ${pair} has a crossed market`);
    }
    const quoteTurnover24h = baseVolume24h * vwap24h;
    if (!Number.isFinite(quoteTurnover24h)) {
      throw new Error(`Kraken ticker ${pair} quote turnover overflowed`);
    }
    observations.push({
      canonicalPair: pair,
      ask,
      bid,
      last,
      baseVolume24h,
      vwap24h,
      quoteTurnover24h,
    });
  }
  return observations.sort((left, right) =>
    left.canonicalPair.localeCompare(right.canonicalPair),
  );
}

function parseBookSide(
  pair: string,
  side: "asks" | "bids",
  value: unknown,
): readonly KrakenOrderBookLevel[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Kraken order book ${pair} has no ${side}`);
  }
  const levels: KrakenOrderBookLevel[] = [];
  let previousPrice: number | undefined;
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length < 3) {
      throw new Error(`Kraken order book ${pair} has malformed ${side}`);
    }
    const price = positiveNumber(raw[0], `order book ${pair} ${side} price`);
    const baseVolume = positiveNumber(
      raw[1],
      `order book ${pair} ${side} volume`,
    );
    const timestampSeconds = Number(raw[2]);
    if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
      throw new Error(`Kraken order book ${pair} has invalid ${side} time`);
    }
    if (
      previousPrice !== undefined &&
      (side === "asks" ? price <= previousPrice : price >= previousPrice)
    ) {
      throw new Error(`Kraken order book ${pair} ${side} are not strictly sorted`);
    }
    previousPrice = price;
    const timestampMs = timestampSeconds * 1_000;
    if (!Number.isSafeInteger(timestampMs)) {
      throw new Error(`Kraken order book ${pair} has unsafe ${side} time`);
    }
    levels.push({ price, baseVolume, timestampMs });
  }
  return levels;
}

export function parseKrakenOrderBook(payload: unknown): KrakenOrderBook {
  if (!isRecord(payload)) {
    throw new Error("Kraken Depth result must be an object");
  }
  const entries = Object.entries(payload);
  if (entries.length !== 1) {
    throw new Error("Kraken Depth result must contain exactly one pair");
  }
  const entry = entries[0];
  if (entry === undefined || !isRecord(entry[1])) {
    throw new Error("Kraken Depth result is malformed");
  }
  const pair = normalizeKrakenDisplayPair(entry[0]);
  const asks = parseBookSide(pair, "asks", entry[1].asks);
  const bids = parseBookSide(pair, "bids", entry[1].bids);
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  if (bestAsk === undefined || bestBid === undefined || bestAsk < bestBid) {
    throw new Error(`Kraken order book ${pair} is crossed or incomplete`);
  }
  return { canonicalPair: pair, asks, bids };
}

function buyImpactBps(
  asks: readonly KrakenOrderBookLevel[],
  candidateQuote: number,
  mid: number,
): number | null {
  let quoteRemaining = candidateQuote;
  let quoteSpent = 0;
  let baseAcquired = 0;
  for (const level of asks) {
    const quoteCapacity = level.price * level.baseVolume;
    const quoteTaken = Math.min(quoteRemaining, quoteCapacity);
    quoteSpent += quoteTaken;
    baseAcquired += quoteTaken / level.price;
    quoteRemaining -= quoteTaken;
    if (quoteRemaining <= 1e-9) break;
  }
  if (quoteRemaining > 1e-9 || baseAcquired <= 0) return null;
  const averagePrice = quoteSpent / baseAcquired;
  return Math.max(0, (averagePrice / mid - 1) * 10_000);
}

function sellImpactBps(
  bids: readonly KrakenOrderBookLevel[],
  candidateQuote: number,
  mid: number,
): number | null {
  let baseRemaining = candidateQuote / mid;
  let baseSold = 0;
  let quoteReceived = 0;
  for (const level of bids) {
    const baseTaken = Math.min(baseRemaining, level.baseVolume);
    baseSold += baseTaken;
    quoteReceived += baseTaken * level.price;
    baseRemaining -= baseTaken;
    if (baseRemaining <= 1e-12) break;
  }
  if (baseRemaining > 1e-12 || baseSold <= 0) return null;
  const averagePrice = quoteReceived / baseSold;
  return Math.max(0, (1 - averagePrice / mid) * 10_000);
}

export function summariseKrakenMarketQuality(
  ticker: KrakenTickerObservation,
  book: KrakenOrderBook,
  candidateOrderQuote: number,
): KrakenMarketQualitySummary {
  if (ticker.canonicalPair !== book.canonicalPair) {
    throw new Error("Ticker and order-book pairs must match");
  }
  const candidate = positiveNumber(candidateOrderQuote, "candidate order quote");
  const bestAsk = book.asks[0]?.price;
  const bestBid = book.bids[0]?.price;
  if (bestAsk === undefined || bestBid === undefined) {
    throw new Error("Kraken order book is incomplete");
  }
  const mid = (bestAsk + bestBid) / 2;
  const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;
  const askQuote = book.asks.reduce(
    (total, level) => total + level.price * level.baseVolume,
    0,
  );
  const bidQuote = book.bids.reduce(
    (total, level) => total + level.price * level.baseVolume,
    0,
  );
  if (
    !Number.isFinite(spreadBps) ||
    !Number.isFinite(askQuote) ||
    !Number.isFinite(bidQuote)
  ) {
    throw new Error("Kraken market quality calculation overflowed");
  }
  const buyImpact = buyImpactBps(book.asks, candidate, mid);
  const sellImpact = sellImpactBps(book.bids, candidate, mid);
  return {
    canonicalPair: ticker.canonicalPair,
    spreadBps,
    availableQuoteVolume: Math.min(askQuote, bidQuote),
    estimatedImpactBps:
      buyImpact === null || sellImpact === null
        ? null
        : Math.max(buyImpact, sellImpact),
    candidateOrderQuote: candidate,
  };
}
