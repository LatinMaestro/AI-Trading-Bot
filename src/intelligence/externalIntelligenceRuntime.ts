import type { ExternalIntelligencePolicy } from "./externalIntelligence.ts";
import {
  createKrakenActiveMaintenanceMinuteSource,
} from "./krakenScheduledMaintenanceIntelligence.ts";
import {
  processExternalIntelligenceQueueBatch,
  runMinuteExternalIntelligenceCollector,
  type ExternalIntelligenceCacheState,
  type ExternalIntelligenceQueueMessage,
  type ExternalIntelligenceQueueProcessingOutcome,
  type ExternalIntelligenceQueueProducer,
  type ExternalIntelligenceQueueRepository,
  type MinuteExternalIntelligenceCollectionReport,
  type MinuteExternalIntelligenceSource,
} from "./queuePipeline.ts";
import type { ExternalIntelligenceSourceContract } from "./sourceRegistry.ts";
import { D1ExternalIntelligenceCacheState } from "../storage/externalIntelligenceCache.ts";
import { ExternalIntelligenceRepository } from "../storage/externalIntelligence.ts";

export const EXTERNAL_INTELLIGENCE_MINUTE_CRON = "* * * * *";
export const TRADING_CYCLE_CRON = "*/15 * * * *";
export const EXTERNAL_INTELLIGENCE_QUEUE_NAME =
  "ai-crypto-trader-preview-external-intelligence";

export const EXTERNAL_INTELLIGENCE_POLICY: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 3_600_000,
    regulator: 3_600_000,
    issuer: 3_600_000,
    "mainstream-news": 1_800_000,
    "specialist-news": 900_000,
    reddit: 300_000,
  },
  maximumReceiptDelayMs: 120_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 5_000,
  maximumItems: 50,
};

export type ScheduledWorkKind =
  | "external-intelligence-minute"
  | "trading-cycle";

export interface DisabledExternalIntelligenceCollectionReport {
  readonly status: "disabled";
  readonly scheduledAtMs: number;
  readonly sourceCount: 0;
}

export interface ExternalIntelligenceRuntimeDependencies {
  readonly createMinuteSource: (
    contract: ExternalIntelligenceSourceContract,
    policy: ExternalIntelligencePolicy,
  ) => Promise<MinuteExternalIntelligenceSource>;
  readonly runCollector: typeof runMinuteExternalIntelligenceCollector;
  readonly processQueueBatch: typeof processExternalIntelligenceQueueBatch;
  readonly createCacheState: (db: D1Database) => ExternalIntelligenceCacheState;
  readonly createRepository: (
    db: D1Database,
  ) => ExternalIntelligenceQueueRepository;
  readonly fetch: typeof fetch;
  readonly nowMs: () => number;
}

const DEFAULT_DEPENDENCIES: ExternalIntelligenceRuntimeDependencies = {
  createMinuteSource: createKrakenActiveMaintenanceMinuteSource,
  runCollector: runMinuteExternalIntelligenceCollector,
  processQueueBatch: processExternalIntelligenceQueueBatch,
  createCacheState: (db) => new D1ExternalIntelligenceCacheState(db),
  createRepository: (db) => new ExternalIntelligenceRepository(db),
  fetch,
  nowMs: Date.now,
};

function runtimeEnabled(value: string): boolean {
  if (value !== "true" && value !== "false") {
    throw new Error(
      "EXTERNAL_INTELLIGENCE_ENABLED must be exactly true or false",
    );
  }
  return value === "true";
}

function sourceContractFromJson(value: string): ExternalIntelligenceSourceContract {
  if (value.length === 0 || value.length > 20_000) {
    throw new Error(
      "KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON must contain one bounded contract",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON must be valid JSON",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON must be an object",
    );
  }
  return parsed as ExternalIntelligenceSourceContract;
}

function queueProducer(queue: Queue<unknown>): ExternalIntelligenceQueueProducer {
  return {
    async send(
      body: ExternalIntelligenceQueueMessage,
      options?: { readonly contentType?: "json" },
    ): Promise<void> {
      await queue.send(body, options);
    },
  };
}

export function scheduledWorkKind(cron: string): ScheduledWorkKind {
  switch (cron) {
    case EXTERNAL_INTELLIGENCE_MINUTE_CRON:
      return "external-intelligence-minute";
    case TRADING_CYCLE_CRON:
      return "trading-cycle";
    default:
      throw new Error(`Unrecognised scheduled trigger: ${cron}`);
  }
}

export async function runExternalIntelligenceMinuteCycle(
  env: Env,
  scheduledAtMs: number,
  dependencies: ExternalIntelligenceRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<
  MinuteExternalIntelligenceCollectionReport |
  DisabledExternalIntelligenceCollectionReport
> {
  if (!runtimeEnabled(env.EXTERNAL_INTELLIGENCE_ENABLED)) {
    return { status: "disabled", scheduledAtMs, sourceCount: 0 };
  }
  const contract = sourceContractFromJson(
    env.KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON,
  );
  const source = await dependencies.createMinuteSource(
    contract,
    EXTERNAL_INTELLIGENCE_POLICY,
  );
  if (env.EXTERNAL_INTELLIGENCE_QUEUE === undefined) {
    throw new Error("EXTERNAL_INTELLIGENCE_QUEUE binding is unavailable");
  }
  return dependencies.runCollector(
    [source],
    queueProducer(env.EXTERNAL_INTELLIGENCE_QUEUE),
    dependencies.createCacheState(env.DB),
    {
      scheduledAtMs,
      fetch: dependencies.fetch,
      nowMs: dependencies.nowMs,
    },
  );
}

export async function consumeExternalIntelligenceQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  dependencies: ExternalIntelligenceRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<readonly ExternalIntelligenceQueueProcessingOutcome[]> {
  if (batch.queue !== EXTERNAL_INTELLIGENCE_QUEUE_NAME) {
    throw new Error(`Unexpected external-intelligence queue: ${batch.queue}`);
  }
  return dependencies.processQueueBatch(
    batch.messages,
    dependencies.createRepository(env.DB),
  );
}
