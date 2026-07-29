import { sha256Hex } from "../utils/crypto.ts";

export const KRAKEN_HISTORICAL_OHLCVT_SOURCE = {
  schemaVersion: 1,
  sourceId: "kraken-official-downloadable-ohlcvt-v1",
  provider: "Kraken",
  publisher: "Payward, Inc.",
  supportPageUrl:
    "https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data",
  completeArchiveUrl:
    "https://drive.google.com/file/d/1ptNqWYidLkhb2VAKuLCxmp2OXEfGO-AP/view?usp=sharing",
  incrementalArchiveFolderUrl:
    "https://drive.google.com/drive/folders/15RSlNuW_h0kVM8or8McOGOMfHeBFvFGI?usp=sharing",
  reviewedAt: "2026-07-29T07:00:00.000Z",
  supportPageUpdatedOn: "2026-04-26",
  acquisitionMode: "hosted-backfill",
  updateCadence: "quarterly",
  approvedPairs: ["BTC/AUD", "ETH/AUD"],
  approvedIntervalsMinutes: [60, 1440],
  rawArchiveRetention: "transient-validation-only",
  derivedCandleRetention: "immutable",
  emptyIntervalPolicy: "preserve-absence-never-forward-fill",
  archiveSha256Required: true,
  selectedCsvSha256Required: true,
  attribution: "Kraken",
  modelTrainingPermitted: false,
  liveDecisionUse: false,
} as const;

export interface KrakenHistoricalOhlcvtSourceManifest {
  readonly contract: typeof KRAKEN_HISTORICAL_OHLCVT_SOURCE;
  readonly contractSha256: string;
}

export async function buildKrakenHistoricalOhlcvtSourceManifest(): Promise<KrakenHistoricalOhlcvtSourceManifest> {
  return {
    contract: KRAKEN_HISTORICAL_OHLCVT_SOURCE,
    contractSha256: await sha256Hex(
      JSON.stringify(KRAKEN_HISTORICAL_OHLCVT_SOURCE),
    ),
  };
}
