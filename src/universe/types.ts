export type UniverseTier = "established" | "high-volatility" | "new-listing";

export type InstrumentKind =
  | "spot"
  | "leveraged-token"
  | "inverse-token"
  | "derivative-wrapper"
  | "unknown";

export type MarketLifecycleEventType =
  | "listed"
  | "trading-online"
  | "trading-suspended"
  | "trading-resumed"
  | "delisted"
  | "au-enabled"
  | "au-disabled";

export type MarketDataQualityState =
  | "complete"
  | "gap"
  | "conflict"
  | "stale"
  | "ambiguous";

export interface MarketDefinition {
  readonly definitionId: string;
  readonly venue: string;
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly instrumentKind: InstrumentKind;
  readonly availableAtMs: number;
  readonly sourceRef: string;
  readonly payloadSha256: string;
}

export interface MarketLifecycleEvent {
  readonly eventId: string;
  readonly venue: string;
  readonly canonicalPair: string;
  readonly eventType: MarketLifecycleEventType;
  readonly effectiveAtMs: number;
  readonly publishedAtMs: number;
  readonly recordedAtMs: number;
  readonly sourceRef: string;
  readonly payloadSha256: string;
}

export interface MarketQualityObservation {
  readonly observationId: string;
  readonly venue: string;
  readonly canonicalPair: string;
  readonly observedAtMs: number;
  readonly availableAtMs: number;
  readonly spreadBps: number;
  readonly quoteTurnoverAud24h: number;
  readonly availableQuoteVolumeAud: number;
  readonly estimatedImpactBps: number;
  readonly minimumOrderAud: number;
  readonly audValuationComplete: boolean;
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly annualisedVolatility: number;
  readonly dataQualityState: MarketDataQualityState;
  readonly payloadSha256: string;
}

export interface UniverseTierLimits {
  readonly minimumQuoteTurnoverAud24h: number;
  readonly minimumAvailableQuoteVolumeAud: number;
  readonly maximumSpreadBps: number;
  readonly maximumEstimatedImpactBps: number;
}

export interface UniversePolicy {
  readonly venue: string;
  readonly countryCode: "AU";
  readonly candidateOrderAud: number;
  readonly maximumObservationAgeMs: number;
  readonly newListingMaximumAgeMs: number;
  readonly newListingMinimumHourlyCandles: number;
  readonly establishedMinimumAgeMs: number;
  readonly establishedMinimumDailyCandles: number;
  readonly establishedMinimumHourlyCandles: number;
  readonly highVolatilityAnnualisedThreshold: number;
  readonly tierLimits: Readonly<Record<UniverseTier, UniverseTierLimits>>;
}

export interface UniverseLifecycleState {
  readonly listedAtMs?: number;
  readonly delistedAtMs?: number;
  readonly online: boolean;
  readonly availableInAustralia: boolean;
  readonly latestTradingEvent?: MarketLifecycleEventType;
  readonly latestAustraliaEvent?: MarketLifecycleEventType;
}

export interface UniverseCandidate {
  readonly venue: string;
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly eligible: boolean;
  readonly tier?: UniverseTier;
  readonly reasons: readonly string[];
  readonly definitionId: string;
  readonly observationId?: string;
  readonly lifecycle: UniverseLifecycleState;
  readonly listingAgeMs?: number;
}

export interface UniverseSnapshot {
  readonly asOfMs: number;
  readonly venue: string;
  readonly countryCode: "AU";
  readonly candidates: readonly UniverseCandidate[];
  readonly eligiblePairs: readonly string[];
}
