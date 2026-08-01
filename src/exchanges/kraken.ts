import type { Candle, OrderIntent } from "../domain/types.ts";
import type {
  ApiKeyInfo,
  ExchangeAdapter,
  ExchangeBalance,
  SubmittedOrder,
} from "./types.ts";
import { krakenSignature } from "../utils/crypto.ts";
import { MonotonicNonce } from "./monotonicNonce.ts";
import { parseKrakenSpotPairs, type SpotPairDefinition } from "../marketData/pairs.ts";

const API_BASE = "https://api.kraken.com";
const FORBIDDEN_PERMISSIONS = new Set([
  "add-funds",
  "withdraw-funds",
  "earn-funds",
  "add-withdraw-address",
  "update-withdraw-address",
]);

interface KrakenEnvelope<T> {
  readonly error: readonly string[];
  readonly result: T;
}

type KrakenOhlcRow = readonly (string | number)[];

export function parseCommittedOhlcRows(
  pair: string,
  rows: readonly KrakenOhlcRow[],
): readonly Candle[] {
  if (rows.length < 2) {
    throw new Error(`Kraken OHLC returned no committed candles for ${pair}`);
  }

  return rows.slice(0, -1).map((row) => {
    const [timestamp, open, high, low, close, , volume] = row;
    const candle: Candle = {
      timestampMs: Number(timestamp) * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
    if (
      !Number.isFinite(candle.timestampMs) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume)
    ) {
      throw new Error(`Kraken OHLC returned malformed data for ${pair}`);
    }
    return candle;
  });
}

export interface KrakenCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
}

export class KrakenSpotAdapter implements ExchangeAdapter {
  private readonly nonce = new MonotonicNonce();
  private readonly credentials: KrakenCredentials | undefined;

  constructor(credentials?: KrakenCredentials) {
    this.credentials = credentials;
  }

  async getSpotPairs(countryCode = "AU"): Promise<readonly SpotPairDefinition[]> {
    const url = new URL("/0/public/AssetPairs", API_BASE);
    url.searchParams.set("assetVersion", "1");
    url.searchParams.set("aclass_base", "currency");
    url.searchParams.set("country_code", countryCode.toUpperCase());
    url.searchParams.set("execution_venue", "international");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Kraken AssetPairs returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as KrakenEnvelope<unknown>;
    this.assertNoErrors(payload.error, "AssetPairs");
    return parseKrakenSpotPairs(payload.result);
  }

  async getDailyCandles(pair: string, sinceSeconds?: number): Promise<readonly Candle[]> {
    const url = new URL("/0/public/OHLC", API_BASE);
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", "1440");
    if (sinceSeconds !== undefined) url.searchParams.set("since", String(sinceSeconds));

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Kraken OHLC returned HTTP ${response.status}`);
    const payload = (await response.json()) as KrakenEnvelope<
      Record<string, readonly (readonly (string | number)[])[] | number>
    >;
    this.assertNoErrors(payload.error, "OHLC");
    const entry = Object.entries(payload.result).find(([key]) => key !== "last");
    if (entry === undefined || !Array.isArray(entry[1])) {
      throw new Error(`Kraken OHLC returned no candles for ${pair}`);
    }

    return parseCommittedOhlcRows(pair, entry[1]);
  }

  async getApiKeyInfo(): Promise<ApiKeyInfo> {
    const result = await this.privateRequest<{ readonly permissions: readonly string[] }>(
      "/0/private/GetApiKeyInfo",
      new URLSearchParams(),
    );
    const forbidden = result.permissions.filter((permission) =>
      FORBIDDEN_PERMISSIONS.has(permission),
    );
    if (forbidden.length > 0) {
      throw new Error(`Unsafe Kraken API permissions: ${forbidden.join(", ")}`);
    }
    return { permissions: result.permissions };
  }

  async getBalances(): Promise<readonly ExchangeBalance[]> {
    const result = await this.privateRequest<Record<string, string>>(
      "/0/private/Balance",
      new URLSearchParams(),
    );
    return Object.entries(result).map(([asset, value]) => ({
      asset,
      available: Number(value),
    }));
  }

  async submitPostOnlyLimit(
    intent: OrderIntent,
    validateOnly: boolean,
  ): Promise<SubmittedOrder> {
    if (!validateOnly) {
      throw new Error("Phase 0 permits Kraken order validation only");
    }
    await this.getApiKeyInfo();
    const form = new URLSearchParams({
      pair: intent.pair,
      type: intent.side,
      ordertype: "limit",
      price: intent.priceAud.toFixed(8),
      volume: intent.volume.toFixed(8),
      oflags: "post",
      validate: validateOnly ? "true" : "false",
    });
    const result = await this.privateRequest<{
      readonly descr: { readonly order: string };
      readonly txid?: readonly string[];
    }>("/0/private/AddOrder", form);
    return {
      exchangeOrderIds: result.txid ?? [],
      description: result.descr.order,
      validatedOnly: validateOnly,
    };
  }

  private async privateRequest<T>(path: string, form: URLSearchParams): Promise<T> {
    if (this.credentials === undefined) {
      throw new Error("Kraken credentials are not configured");
    }
    const nonce = this.nonce.next();
    form.set("nonce", nonce);
    const body = form.toString();
    const signature = await krakenSignature(
      path,
      nonce,
      body,
      this.credentials.apiSecret,
    );
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "API-Key": this.credentials.apiKey,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) throw new Error(`Kraken private API returned HTTP ${response.status}`);
    const payload = (await response.json()) as KrakenEnvelope<T>;
    this.assertNoErrors(payload.error, path);
    return payload.result;
  }

  private assertNoErrors(errors: readonly string[], operation: string): void {
    if (errors.length > 0) {
      throw new Error(`Kraken ${operation} error: ${errors.join("; ")}`);
    }
  }
}
