import type { OrderSide } from "../domain/types.ts";
import { normalizeAudPairSymbol } from "../marketData/symbols.ts";
import { sha256Hex } from "../utils/crypto.ts";

export interface OrderFingerprintInput {
  readonly scheduleKey: string;
  readonly strategyVersion: string;
  readonly pair: string;
  readonly side: OrderSide;
  readonly priceQuote: string;
  readonly volume: string;
}

export interface OrderIntentReservation {
  readonly created: boolean;
  readonly intentId: string;
  readonly requestFingerprint: string;
}

export interface OrderIntentInsert {
  readonly intentId: string;
  readonly decisionId: string;
  readonly mode: string;
  readonly pair: string;
  readonly side: OrderSide;
  readonly priceAud: number;
  readonly volume: number;
  readonly maxNotionalAud: number;
  readonly requestFingerprint: string;
  readonly createdAt: string;
}

export const RESERVE_ORDER_INTENT_SQL = `
  INSERT INTO order_intents
    (intent_id, decision_id, mode, pair, side, order_type, price_aud, volume,
     max_notional_aud, status, exchange_order_id, request_fingerprint, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'limit', ?, ?, ?,
          'reserved', NULL, ?, ?, ?)
  ON CONFLICT(request_fingerprint) DO NOTHING
`;

function canonicalDecimalString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || !/[1-9]/.test(trimmed)) {
    throw new Error(`${field} must be a positive plain decimal string`);
  }
  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

export async function buildOrderRequestFingerprint(
  input: OrderFingerprintInput,
): Promise<string> {
  const scheduleKey = input.scheduleKey.trim();
  const strategyVersion = input.strategyVersion.trim();
  if (scheduleKey === "" || strategyVersion === "") {
    throw new Error("Order fingerprint identifiers cannot be empty");
  }
  const canonical = JSON.stringify({
    scheduleKey,
    strategyVersion,
    pair: normalizeAudPairSymbol(input.pair),
    side: input.side,
    priceQuote: canonicalDecimalString(input.priceQuote, "priceQuote"),
    volume: canonicalDecimalString(input.volume, "volume"),
  });
  return sha256Hex(canonical);
}

export class OrderIntentRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async reserveOrderIntent(input: OrderIntentInsert): Promise<OrderIntentReservation> {
    const result = await this.db
      .prepare(RESERVE_ORDER_INTENT_SQL)
      .bind(
        input.intentId,
        input.decisionId,
        input.mode,
        input.pair,
        input.side,
        input.priceAud,
        input.volume,
        input.maxNotionalAud,
        input.requestFingerprint,
        input.createdAt,
        input.createdAt,
      )
      .run();

    if (result.meta.changes === 1) {
      return {
        created: true,
        intentId: input.intentId,
        requestFingerprint: input.requestFingerprint,
      };
    }

    const existing = await this.db
      .prepare(
        `SELECT intent_id
         FROM order_intents
         WHERE request_fingerprint = ?
         LIMIT 1`,
      )
      .bind(input.requestFingerprint)
      .first<{ readonly intent_id: string }>();
    if (existing === null) {
      throw new Error("Order intent conflict did not resolve to an existing row");
    }
    return {
      created: false,
      intentId: existing.intent_id,
      requestFingerprint: input.requestFingerprint,
    };
  }
}
