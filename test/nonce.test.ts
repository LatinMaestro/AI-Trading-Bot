import assert from "node:assert/strict";
import test from "node:test";
import { MonotonicNonce } from "../src/exchanges/monotonicNonce.ts";

test("nonce increases during repeated calls in the same millisecond", () => {
  const nonce = new MonotonicNonce(() => 1_000);
  const first = BigInt(nonce.next());
  const second = BigInt(nonce.next());
  const third = BigInt(nonce.next());
  assert.ok(first < second);
  assert.ok(second < third);
});

test("nonce remains increasing if the system clock moves backwards", () => {
  const times = [1_000, 999, 998];
  const nonce = new MonotonicNonce(() => times.shift() ?? 998);
  const first = BigInt(nonce.next());
  const second = BigInt(nonce.next());
  const third = BigInt(nonce.next());
  assert.ok(first < second);
  assert.ok(second < third);
});
