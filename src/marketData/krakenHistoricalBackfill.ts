import type { Candle } from "../domain/types.ts";
import {
  assertSupportedInterval,
  intervalMs,
  type CandleIntervalMinutes,
} from "./candleIntervals.ts";
import {
  buildKrakenHistoricalOhlcvtSourceManifest,
  KRAKEN_HISTORICAL_OHLCVT_SOURCE,
} from "./krakenHistoricalOhlcvt.ts";
import { sha256Hex } from "../utils/crypto.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const MAXIMUM_CSV_BYTES = 64 * 1024 * 1024;
const MAXIMUM_CSV_ROWS = 2_000_000;

export type KrakenHistoricalArchiveKind = "complete" | "quarterly";

export interface KrakenHistoricalCsvCapture {
  readonly sourceContractSha256: string;
  readonly archiveKind: KrakenHistoricalArchiveKind;
  readonly archiveUrl: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly acquiredAt: string;
  readonly csvMemberName: string;
  readonly csvSha256: string;
  readonly csvByteLength: number;
  readonly csvText: string;
  readonly canonicalPair: "BTC/AUD" | "ETH/AUD";
  readonly exchangePair: "XBTAUD" | "ETHAUD";
  readonly intervalMinutes: CandleIntervalMinutes;
}

export interface KrakenHistoricalCandle extends Candle {
  readonly vwap: number;
  readonly tradeCount: number;
  readonly candleSha256: string;
}

export interface PreparedKrakenHistoricalCsv {
  readonly sourceContractSha256: string;
  readonly archiveKind: KrakenHistoricalArchiveKind;
  readonly archiveUrl: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly acquiredAt: string;
  readonly csvMemberName: string;
  readonly csvSha256: string;
  readonly csvByteLength: number;
  readonly canonicalPair: "BTC/AUD" | "ETH/AUD";
  readonly exchangePair: "XBTAUD" | "ETHAUD";
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly rowCount: number;
  readonly firstOpenTimeMs: number;
  readonly lastOpenTimeMs: number;
  readonly candles: readonly KrakenHistoricalCandle[];
  readonly csvManifestSha256: string;
}

export interface ReconciledKrakenHistoricalBackfill
  extends PreparedKrakenHistoricalCsv {
  readonly restOverlapCount: number;
  readonly restOverlapSha256: string;
  readonly backfillId: string;
}

function assertSha256(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256`);
  }
}

function assertCanonicalIso(name: string, value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO-8601 timestamp`);
  }
  return parsed;
}

function assertSafePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function expectedExchangePair(
  canonicalPair: KrakenHistoricalCsvCapture["canonicalPair"],
): KrakenHistoricalCsvCapture["exchangePair"] {
  return canonicalPair === "BTC/AUD" ? "XBTAUD" : "ETHAUD";
}

function assertArchiveUrl(
  kind: KrakenHistoricalArchiveKind,
  archiveUrl: string,
): void {
  if (
    kind === "complete" &&
    archiveUrl !== KRAKEN_HISTORICAL_OHLCVT_SOURCE.completeArchiveUrl
  ) {
    throw new Error("Complete archive URL is not the reviewed Kraken source");
  }
  if (kind === "quarterly") {
    let url: URL;
    try {
      url = new URL(archiveUrl);
    } catch {
      throw new Error("Quarterly archive URL is invalid");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      !/^\/file\/d\/[A-Za-z0-9_-]+\/view$/u.test(url.pathname) ||
      url.search !== "?usp=sharing" ||
      url.hash.length > 0
    ) {
      throw new Error("Quarterly archive URL is not a canonical Drive file");
    }
  }
}

function parseDecimal(name: string, value: string): number {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`${name} is not a canonical non-negative decimal`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} is not finite`);
  }
  return parsed;
}

function parsePositiveDecimal(name: string, value: string): number {
  const parsed = parseDecimal(name, value);
  if (parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function parseSafeInteger(name: string, value: string): number {
  if (!INTEGER_PATTERN.test(value)) {
    throw new Error(`${name} is not a canonical integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds the safe integer range`);
  }
  return parsed;
}

function splitCsvLines(csvText: string): readonly string[] {
  if (csvText.length === 0 || csvText.charCodeAt(0) === 0xfeff) {
    throw new Error("Historical CSV must be non-empty UTF-8 without a BOM");
  }
  if (csvText.includes("\0") || /[^\r]\r/u.test(csvText)) {
    throw new Error("Historical CSV contains invalid control/newline content");
  }
  const normalised = csvText.replace(/\r\n/gu, "\n");
  const lines = normalised.endsWith("\n")
    ? normalised.slice(0, -1).split("\n")
    : normalised.split("\n");
  if (
    lines.length === 0 ||
    lines.length > MAXIMUM_CSV_ROWS ||
    lines.some((line) => line.length === 0)
  ) {
    throw new Error("Historical CSV row count is invalid");
  }
  return lines;
}

export async function prepareKrakenHistoricalCsv(
  input: KrakenHistoricalCsvCapture,
): Promise<PreparedKrakenHistoricalCsv> {
  const sourceManifest = await buildKrakenHistoricalOhlcvtSourceManifest();
  assertSha256("sourceContractSha256", input.sourceContractSha256);
  if (input.sourceContractSha256 !== sourceManifest.contractSha256) {
    throw new Error("Historical source contract digest mismatch");
  }
  assertSha256("archiveSha256", input.archiveSha256);
  assertSha256("csvSha256", input.csvSha256);
  assertSafePositiveInteger("archiveByteLength", input.archiveByteLength);
  assertSafePositiveInteger("csvByteLength", input.csvByteLength);
  if (input.csvByteLength > MAXIMUM_CSV_BYTES) {
    throw new Error("Historical CSV exceeds the validation limit");
  }
  const acquiredAtMs = assertCanonicalIso("acquiredAt", input.acquiredAt);
  assertSupportedInterval(input.intervalMinutes);
  assertArchiveUrl(input.archiveKind, input.archiveUrl);
  if (input.exchangePair !== expectedExchangePair(input.canonicalPair)) {
    throw new Error("Historical CSV pair identity mismatch");
  }
  const expectedMemberName =
    `${input.exchangePair}_${input.intervalMinutes}.csv`;
  if (input.csvMemberName !== expectedMemberName) {
    throw new Error("Historical CSV member identity mismatch");
  }

  const actualCsvByteLength = new TextEncoder().encode(input.csvText).length;
  if (actualCsvByteLength !== input.csvByteLength) {
    throw new Error("Historical CSV byte length mismatch");
  }
  if ((await sha256Hex(input.csvText)) !== input.csvSha256) {
    throw new Error("Historical CSV digest mismatch");
  }

  const stepMs = intervalMs(input.intervalMinutes);
  const candles: KrakenHistoricalCandle[] = [];
  let previousOpenTimeMs: number | undefined;
  for (const [index, line] of splitCsvLines(input.csvText).entries()) {
    const fields = line.split(",");
    if (fields.length !== 8) {
      throw new Error(`Historical CSV row ${index + 1} must have 8 fields`);
    }
    const timestampSeconds = parseSafeInteger(
      `Historical CSV row ${index + 1} timestamp`,
      fields[0] ?? "",
    );
    if (timestampSeconds > Number.MAX_SAFE_INTEGER / 1000) {
      throw new Error("Historical CSV timestamp exceeds the safe range");
    }
    const timestampMs = timestampSeconds * 1000;
    if (timestampMs % stepMs !== 0) {
      throw new Error("Historical CSV contains a misaligned timestamp");
    }
    if (
      previousOpenTimeMs !== undefined &&
      timestampMs <= previousOpenTimeMs
    ) {
      throw new Error(
        "Historical CSV timestamps must be unique and strictly ordered",
      );
    }
    previousOpenTimeMs = timestampMs;

    const open = parsePositiveDecimal("Historical CSV open", fields[1] ?? "");
    const high = parsePositiveDecimal("Historical CSV high", fields[2] ?? "");
    const low = parsePositiveDecimal("Historical CSV low", fields[3] ?? "");
    const close = parsePositiveDecimal(
      "Historical CSV close",
      fields[4] ?? "",
    );
    const vwap = parsePositiveDecimal("Historical CSV vwap", fields[5] ?? "");
    const volume = parseDecimal("Historical CSV volume", fields[6] ?? "");
    const tradeCount = parseSafeInteger(
      "Historical CSV trade count",
      fields[7] ?? "",
    );
    if (
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high ||
      tradeCount <= 0
    ) {
      throw new Error("Historical CSV contains inconsistent OHLCVT data");
    }
    if (timestampMs + stepMs > acquiredAtMs) {
      throw new Error("Historical CSV contains an uncommitted candle");
    }
    const candleSha256 = await sha256Hex(
      JSON.stringify([
        "kraken",
        input.canonicalPair,
        input.exchangePair,
        input.intervalMinutes,
        timestampMs,
        open,
        high,
        low,
        close,
        vwap,
        volume,
        tradeCount,
      ]),
    );
    candles.push({
      timestampMs,
      open,
      high,
      low,
      close,
      vwap,
      volume,
      tradeCount,
      candleSha256,
    });
  }

  const firstOpenTimeMs = candles[0]?.timestampMs;
  const lastOpenTimeMs = candles.at(-1)?.timestampMs;
  if (firstOpenTimeMs === undefined || lastOpenTimeMs === undefined) {
    throw new Error("Historical CSV contains no candles");
  }
  const csvManifestSha256 = await sha256Hex(
    JSON.stringify([
      input.sourceContractSha256,
      input.archiveKind,
      input.archiveUrl,
      input.archiveSha256,
      input.archiveByteLength,
      input.acquiredAt,
      input.csvMemberName,
      input.csvSha256,
      input.csvByteLength,
      input.canonicalPair,
      input.exchangePair,
      input.intervalMinutes,
      candles.map((candle) => candle.candleSha256),
    ]),
  );
  return {
    sourceContractSha256: input.sourceContractSha256,
    archiveKind: input.archiveKind,
    archiveUrl: input.archiveUrl,
    archiveSha256: input.archiveSha256,
    archiveByteLength: input.archiveByteLength,
    acquiredAt: input.acquiredAt,
    csvMemberName: input.csvMemberName,
    csvSha256: input.csvSha256,
    csvByteLength: input.csvByteLength,
    canonicalPair: input.canonicalPair,
    exchangePair: input.exchangePair,
    intervalMinutes: input.intervalMinutes,
    rowCount: candles.length,
    firstOpenTimeMs,
    lastOpenTimeMs,
    candles,
    csvManifestSha256,
  };
}

function assertRestCandle(
  candle: Candle,
  intervalMinutes: CandleIntervalMinutes,
): void {
  const stepMs = intervalMs(intervalMinutes);
  if (
    !Number.isSafeInteger(candle.timestampMs) ||
    candle.timestampMs < 0 ||
    candle.timestampMs % stepMs !== 0 ||
    ![
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ].every(Number.isFinite) ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.volume < 0
  ) {
    throw new Error("REST overlap candle is invalid");
  }
}

export async function reconcileKrakenHistoricalCsv(
  prepared: PreparedKrakenHistoricalCsv,
  restCandles: readonly Candle[],
): Promise<ReconciledKrakenHistoricalBackfill> {
  if (restCandles.length === 0) {
    throw new Error("Historical CSV requires a committed REST overlap");
  }
  const historicalByOpen = new Map(
    prepared.candles.map((candle) => [candle.timestampMs, candle]),
  );
  const overlapIdentities: string[] = [];
  let previousOpenTimeMs: number | undefined;
  for (const rest of restCandles) {
    assertRestCandle(rest, prepared.intervalMinutes);
    if (
      rest.timestampMs < prepared.firstOpenTimeMs ||
      rest.timestampMs > prepared.lastOpenTimeMs ||
      (previousOpenTimeMs !== undefined &&
        rest.timestampMs <= previousOpenTimeMs)
    ) {
      throw new Error("REST overlap chronology is invalid");
    }
    previousOpenTimeMs = rest.timestampMs;
    const historical = historicalByOpen.get(rest.timestampMs);
    if (
      historical === undefined ||
      historical.open !== rest.open ||
      historical.high !== rest.high ||
      historical.low !== rest.low ||
      historical.close !== rest.close ||
      historical.volume !== rest.volume
    ) {
      throw new Error("Historical CSV conflicts with committed REST candles");
    }
    overlapIdentities.push(
      await sha256Hex(
        JSON.stringify([
          rest.timestampMs,
          rest.open,
          rest.high,
          rest.low,
          rest.close,
          rest.volume,
          historical.candleSha256,
        ]),
      ),
    );
  }
  const restOverlapSha256 = await sha256Hex(
    JSON.stringify(overlapIdentities),
  );
  const backfillId = await sha256Hex(
    JSON.stringify([
      "kraken-historical-ohlcvt-backfill-v1",
      prepared.csvManifestSha256,
      restCandles.length,
      restOverlapSha256,
    ]),
  );
  return {
    ...prepared,
    restOverlapCount: restCandles.length,
    restOverlapSha256,
    backfillId,
  };
}
