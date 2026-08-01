export class MonotonicNonce {
  private lastNonce = 0n;
  private readonly nowMs: () => number;

  constructor(nowMs: () => number = Date.now) {
    this.nowMs = nowMs;
  }

  next(): string {
    const clockNonce = BigInt(this.nowMs()) * 1_000n;
    this.lastNonce =
      clockNonce > this.lastNonce ? clockNonce : this.lastNonce + 1n;
    return this.lastNonce.toString();
  }
}
