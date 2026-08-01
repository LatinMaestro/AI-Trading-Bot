import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([".git", "node_modules", ".wrangler"]);
const ignoredFiles = new Set(["scripts/check-secrets.mjs"]);
const maximumFileBytes = 2_000_000;

const secretPatterns = [
  {
    label: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/,
  },
  {
    label: "Stripe live secret key",
    pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/,
  },
  {
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    label: "credential-bearing connection URI",
    pattern: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^/\s:@]+:[^/\s@]+@/i,
  },
  {
    label: "configured exchange or activation secret",
    pattern:
      /\b(?:KRAKEN_API_KEY|KRAKEN_API_SECRET|LIVE_ACTIVATION_SECRET)\b\s*[:=]\s*["'`][A-Za-z0-9+/=_-]{20,}["'`]/,
  },
];

const positiveSelfTests = [
  "-----BEGIN " + "PRIVATE KEY-----",
  "AK" + "IAABCDEFGHIJKLMNOP",
  "gh" + "p_" + "a".repeat(40),
  "github_" + "pat_" + "a".repeat(60),
  "sk_" + "live_" + "a".repeat(24),
  "xox" + "b-" + "a".repeat(20),
  "postgresql://" + "user:" + "password@" + "database.invalid/db",
  "KRAKEN_API_SECRET=" + String.fromCharCode(34) + "a".repeat(32) + String.fromCharCode(34),
];
for (const sample of positiveSelfTests) {
  if (!secretPatterns.some(({ pattern }) => pattern.test(sample))) {
    throw new Error("Secret-pattern scanner self-test failed");
  }
}
for (const pattern of secretPatterns) pattern.pattern.lastIndex = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await walk(root)) {
  const relativePath = relative(root, file);
  if (ignoredFiles.has(relativePath)) continue;
  const bytes = await readFile(file);
  if (bytes.length > maximumFileBytes || bytes.includes(0)) continue;
  const content = bytes.toString("utf8");
  for (const item of secretPatterns) {
    if (item.pattern.test(content)) violations.push(`${relativePath}: ${item.label}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("High-confidence secret-pattern scan passed");
