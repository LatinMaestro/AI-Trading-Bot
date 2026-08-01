import { sha256Hex } from "../utils/crypto.ts";

export function canonicalIntelligenceJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalise non-finite intelligence data");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalIntelligenceJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalIntelligenceJson(entry)}`,
      )
      .join(",")}}`;
  }
  throw new Error("Cannot canonicalise unsupported intelligence data");
}

export async function sha256CanonicalIntelligence(
  value: unknown,
): Promise<string> {
  return sha256Hex(canonicalIntelligenceJson(value));
}
