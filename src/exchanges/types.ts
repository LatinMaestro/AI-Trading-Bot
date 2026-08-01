import type { Candle, OrderIntent } from "../domain/types.ts";

export interface ApiKeyInfo {
  readonly permissions: readonly string[];
}

export interface ExchangeBalance {
  readonly asset: string;
  readonly available: number;
}

export interface SubmittedOrder {
  readonly exchangeOrderIds: readonly string[];
  readonly description: string;
  readonly validatedOnly: boolean;
}

export interface ExchangeAdapter {
  getDailyCandles(pair: string, sinceSeconds?: number): Promise<readonly Candle[]>;
  getApiKeyInfo(): Promise<ApiKeyInfo>;
  getBalances(): Promise<readonly ExchangeBalance[]>;
  submitPostOnlyLimit(
    intent: OrderIntent,
    validateOnly: boolean,
  ): Promise<SubmittedOrder>;
}
