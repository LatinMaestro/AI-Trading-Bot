export type UniverseTier = "established" | "high-volatility" | "new-listing";
export type MarketLifecycleStatus = "online" | "suspended" | "delisted";
export type InstrumentType = "spot" | "leveraged-token" | "inverse-token" | "derivative-wrapper";

export interface MarketMembershipRecord {
  readonly venue: string;
  readonly canonicalPair: string;
  readonly availableInAustralia: boolean;
  readonly instrumentType: InstrumentType;
  readonly status: MarketLifecycleStatus;
  readonly effectiveFromMs: number;
  readonly effectiveToMs?: number;
  readonly listingTimestampMs: number;
  readonly quoteAsset: string;
}

export interface UniverseObservation {
  readonly timestampMs: number;
  readonly canonicalPair: string;
  readonly committedDailyCandles: number;
  readonly committedHourlyCandles: number;
  readonly annualisedVolatility: number;
  readonly spreadBps: number;
  readonly quoteTurnoverAud: number;
  readonly availableQuoteVolumeAud: number;
  readonly minimumOrderAud: number;
  readonly estimatedImpactBps: number;
  readonly hasAudValuationPath: boolean;
  readonly dataComplete: boolean;
}

export interface UniversePolicy {
  readonly establishedMinimumDailyCandles: number;
  readonly establishedMinimumHourlyCandles: number;
  readonly newListingMaximumAgeDays: number;
  readonly highVolatilityThreshold: number;
  readonly maximumSpreadBps: number;
  readonly minimumQuoteTurnoverAud: number;
  readonly minimumAvailableQuoteVolumeAud: number;
  readonly maximumEstimatedImpactBps: number;
  readonly maximumMinimumOrderShareOfEquity: number;
}

export interface UniverseCandidate {
  readonly canonicalPair: string;
  readonly eligible: boolean;
  readonly tier?: UniverseTier;
  readonly reasons: readonly string[];
}
