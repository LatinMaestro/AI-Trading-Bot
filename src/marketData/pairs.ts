import { normalizeAudPairSymbol } from "./symbols.ts";

export interface SpotPairDefinition {
  readonly canonicalSymbol: string;
  readonly exchangeSymbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: string;
  readonly priceDecimals: number;
  readonly volumeDecimals: number;
  readonly minimumOrderVolume: number;
  readonly minimumOrderCostQuote: number;
  readonly tickSizeQuote: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  pairKey: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Kraken pair ${pairKey} has invalid ${field}`);
  }
  return value.trim();
}

function requiredInteger(
  record: Readonly<Record<string, unknown>>,
  field: string,
  pairKey: string,
): number {
  const value = record[field];
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`Kraken pair ${pairKey} has invalid ${field}`);
  }
  return Number(value);
}

function requiredPositiveNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
  pairKey: string,
): number {
  const value = Number(record[field]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Kraken pair ${pairKey} has invalid ${field}`);
  }
  return value;
}

export function parseKrakenSpotPairs(payload: unknown): readonly SpotPairDefinition[] {
  if (!isRecord(payload)) {
    throw new Error("Kraken AssetPairs result must be an object");
  }

  return Object.entries(payload)
    .map(([pairKey, raw]) => {
      if (!isRecord(raw)) {
        throw new Error(`Kraken pair ${pairKey} must be an object`);
      }
      const baseAsset = requiredString(raw, "base", pairKey).toUpperCase();
      const quoteAsset = requiredString(raw, "quote", pairKey).toUpperCase();
      const canonicalSymbol =
        quoteAsset === "AUD"
          ? normalizeAudPairSymbol(`${baseAsset}/${quoteAsset}`)
          : `${baseAsset}/${quoteAsset}`;

      return {
        canonicalSymbol,
        exchangeSymbol: requiredString(raw, "altname", pairKey).toUpperCase(),
        baseAsset: canonicalSymbol.split("/")[0] ?? baseAsset,
        quoteAsset,
        status: requiredString(raw, "status", pairKey).toLowerCase(),
        priceDecimals: requiredInteger(raw, "pair_decimals", pairKey),
        volumeDecimals: requiredInteger(raw, "lot_decimals", pairKey),
        minimumOrderVolume: requiredPositiveNumber(raw, "ordermin", pairKey),
        minimumOrderCostQuote: requiredPositiveNumber(raw, "costmin", pairKey),
        tickSizeQuote: requiredPositiveNumber(raw, "tick_size", pairKey),
      } satisfies SpotPairDefinition;
    })
    .sort((a, b) => a.canonicalSymbol.localeCompare(b.canonicalSymbol));
}

export function selectApprovedAudPairs(
  availablePairs: readonly SpotPairDefinition[],
  approvedSymbols: readonly string[],
): readonly SpotPairDefinition[] {
  const requested = approvedSymbols.map(normalizeAudPairSymbol);
  if (new Set(requested).size !== requested.length) {
    throw new Error("Approved pair list contains duplicates after normalisation");
  }

  const audPairs = availablePairs.filter((pair) => pair.quoteAsset === "AUD");
  const availableBySymbol = new Map<string, SpotPairDefinition>();
  for (const pair of audPairs) {
    if (availableBySymbol.has(pair.canonicalSymbol)) {
      throw new Error(`Kraken returned duplicate pair ${pair.canonicalSymbol}`);
    }
    availableBySymbol.set(pair.canonicalSymbol, pair);
  }

  return requested.map((symbol) => {
    const pair = availableBySymbol.get(symbol);
    if (pair === undefined) {
      throw new Error(`Approved pair ${symbol} is not available from Kraken`);
    }
    if (pair.status !== "online") {
      throw new Error(`Approved pair ${symbol} is not online`);
    }
    return pair;
  });
}
