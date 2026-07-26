import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const allowedExtensions = new Set([".ts", ".js", ".mjs", ".json", ".jsonc", ".md", ".yml", ".yaml", ".sql"]);
const ignoredDirectories = new Set([".git", "node_modules", ".wrangler"]);
const forbiddenPatterns = [
  { label: "withdraw endpoint or implementation", pattern: /(?:\/withdraw|withdrawal implementation|submitWithdrawal)/i },
  { label: "seed phrase handling", pattern: /(?:mnemonicTo|seedPhrase|seed phrase input)/i },
  { label: "wallet private-key handling", pattern: /(?:WALLET_PRIVATE_KEY|importPrivateKey|privateKeyToAccount)/i },
  { label: "leverage or derivatives implementation", pattern: /(?:setLeverage|futures client|perpetual client|margin order)/i },
];
const allowlistedFiles = new Set([
  "AGENTS.md",
  "CODEX_START_PROMPT.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/CLIENT_ACTIONS.md",
  "docs/DECISION_LOG.md",
  "docs/DEFINITION_OF_DONE.md",
  "docs/LIVE_ACTIVATION_CHECKLIST.md",
  "docs/MASTER_PLAN.md",
  "docs/RISK_POLICY.md",
  "docs/SECURITY_MODEL.md",
  "docs/SPECIFICATION_SOURCE_OF_TRUTH.md",
  "docs/VENUE_RESEARCH.md",
  "scripts/check-forbidden.mjs",
  "src/exchanges/kraken.ts"
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (allowedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await walk(root)) {
  const relativePath = relative(root, file);
  if (allowlistedFiles.has(relativePath)) continue;
  const content = await readFile(file, "utf8");
  for (const item of forbiddenPatterns) {
    if (item.pattern.test(content)) violations.push(`${relativePath}: ${item.label}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Forbidden-capability scan passed");
