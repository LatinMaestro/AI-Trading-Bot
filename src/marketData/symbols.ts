export function normalizeAudPairSymbol(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (!compact.endsWith("AUD") || compact.length <= 3) {
    throw new Error(`Pair ${value} must be an AUD spot pair`);
  }

  const rawBase = compact.slice(0, -3);
  const base = rawBase === "XBT" ? "BTC" : rawBase;
  if (!/^[A-Z0-9]+$/.test(base)) {
    throw new Error(`Pair ${value} has an invalid base asset`);
  }
  return `${base}/AUD`;
}
