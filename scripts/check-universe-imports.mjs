import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = "src";
const internalModule = "universe/reconstruct.ts";
const allowedImporter = "universe/index.ts";
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!path.endsWith(".ts")) continue;
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (relativePath === internalModule || relativePath === allowedImporter) continue;
    const source = readFileSync(path, "utf8");
    if (
      source.includes('from "./universe/reconstruct.ts"') ||
      source.includes('from "../universe/reconstruct.ts"') ||
      source.includes('from "../../universe/reconstruct.ts"') ||
      source.includes('from "./reconstruct.ts"')
    ) {
      violations.push(relativePath);
    }
  }
}

walk(root);

if (violations.length > 0) {
  console.error(
    `Production source must import universe reconstruction through src/universe/index.ts: ${violations.join(", ")}`,
  );
  process.exit(1);
}

console.log("Universe import boundary check passed");
