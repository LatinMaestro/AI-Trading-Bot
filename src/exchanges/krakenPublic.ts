import {
  parseKrakenOrderBook,
  parseKrakenTickers,
  normalizeKrakenDisplayPair,
  type KrakenOrderBook,
  type KrakenTickerObservation,
} from "../marketData/krakenQuality.ts";
import {
  parseKrakenSpotPairs,
  type SpotPairDefinition,
} from "../marketData/pairs.ts";
import { sha256Hex } from "../utils/crypto.ts";

const API_BASE = "https://api.kraken.com";

interface KrakenEnvelope<T> {
  readonly error: readonly string[];
  readonly result: T;
}

type PublicFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface KrakenPublicEvidence<T> {
  readonly sourceId: string;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly data: T;
}

function assertCountryCode(value: string): string {
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Kraken country code must be ISO alpha-2");
  }
  return country;
}

function assertErrors(errors: readonly string[], operation: string): void {
  if (errors.length > 0) {
    throw new Error(`Kraken ${operation} error: ${errors.join("; ")}`);
  }
}

function parseEnvelope(text: string, operation: string): KrakenEnvelope<unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Kraken ${operation} returned invalid JSON`);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !Array.isArray((payload as { readonly error?: unknown }).error) ||
    !("result" in payload)
  ) {
    throw new Error(`Kraken ${operation} returned an invalid envelope`);
  }
  const envelope = payload as KrakenEnvelope<unknown>;
  if (!envelope.error.every((item) => typeof item === "string")) {
    throw new Error(`Kraken ${operation} returned invalid errors`);
  }
  assertErrors(envelope.error, operation);
  return envelope;
}

export class KrakenPublicMarketClient {
  private readonly fetcher: PublicFetch;
  private readonly clock: () => number;

  constructor(fetcher: PublicFetch = fetch, clock: () => number = Date.now) {
    this.fetcher = fetcher;
    this.clock = clock;
  }

  async fetchAssetPairs(
    countryCode = "AU",
  ): Promise<KrakenPublicEvidence<readonly SpotPairDefinition[]>> {
    const url = new URL("/0/public/AssetPairs", API_BASE);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("aclass_base", "currency");
    url.searchParams.set("country_code", assertCountryCode(countryCode));
    url.searchParams.set("execution_venue", "international");
    const raw = await this.fetchEvidence(url, "AssetPairs");
    return {
      ...raw,
      data: parseKrakenSpotPairs(raw.result),
    };
  }

  async fetchTickers(
    pairs?: readonly string[],
  ): Promise<KrakenPublicEvidence<readonly KrakenTickerObservation[]>> {
    const url = new URL("/0/public/Ticker", API_BASE);
    url.searchParams.set("assetVersion", "1");
    if (pairs !== undefined) {
      if (pairs.length === 0) {
        throw new Error("Kraken Ticker pair list cannot be empty");
      }
      const canonical = pairs.map(normalizeKrakenDisplayPair).sort();
      if (new Set(canonical).size !== canonical.length) {
        throw new Error("Kraken Ticker pair list contains duplicates");
      }
      url.searchParams.set("pair", canonical.join(","));
    }
    const raw = await this.fetchEvidence(url, "Ticker");
    const data = parseKrakenTickers(raw.result);
    if (pairs !== undefined) {
      const requested = new Set(pairs.map(normalizeKrakenDisplayPair));
      if (
        data.length !== requested.size ||
        data.some((ticker) => !requested.has(ticker.canonicalPair))
      ) {
        throw new Error("Kraken Ticker did not return exactly the requested pairs");
      }
    }
    return { ...raw, data };
  }

  async fetchOrderBook(
    pair: string,
    count = 100,
  ): Promise<KrakenPublicEvidence<KrakenOrderBook>> {
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new Error("Kraken Depth count must be an integer from 1 to 500");
    }
    const canonical = normalizeKrakenDisplayPair(pair);
    const url = new URL("/0/public/Depth", API_BASE);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("pair", canonical);
    url.searchParams.set("count", String(count));
    const raw = await this.fetchEvidence(url, "Depth");
    const data = parseKrakenOrderBook(raw.result);
    if (data.canonicalPair !== canonical) {
      throw new Error("Kraken Depth returned a different pair");
    }
    return { ...raw, data };
  }

  private async fetchEvidence(
    url: URL,
    operation: string,
  ): Promise<{
    readonly sourceId: string;
    readonly sourceRef: string;
    readonly fetchedAtMs: number;
    readonly payloadSha256: string;
    readonly result: unknown;
  }> {
    const response = await this.fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Kraken ${operation} returned HTTP ${response.status}`);
    }
    const text = await response.text();
    const envelope = parseEnvelope(text, operation);
    const fetchedAtMs = this.clock();
    if (!Number.isSafeInteger(fetchedAtMs) || fetchedAtMs < 0) {
      throw new Error("Kraken evidence clock returned an invalid time");
    }
    const payloadSha256 = await sha256Hex(text);
    return {
      sourceId: `kraken:${operation.toLowerCase()}:${fetchedAtMs}:${payloadSha256.slice(0, 16)}`,
      sourceRef: url.toString(),
      fetchedAtMs,
      payloadSha256,
      result: envelope.result,
    };
  }
}
