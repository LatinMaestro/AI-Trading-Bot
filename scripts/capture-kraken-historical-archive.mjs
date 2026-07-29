import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  prepareKrakenHistoricalCsv,
} from "../src/marketData/krakenHistoricalBackfill.ts";
import {
  buildKrakenHistoricalOhlcvtSourceManifest,
  KRAKEN_HISTORICAL_OHLCVT_SOURCE,
} from "../src/marketData/krakenHistoricalOhlcvt.ts";
import { bytesToHex } from "../src/utils/encoding.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const MAXIMUM_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_LISTING_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CSV_BYTES = 64 * 1024 * 1024;
const MAXIMUM_ARCHIVE_ENTRIES = 100_000;
const REQUIRED_MEMBERS = [
  {
    basename: "ETHAUD_1440.csv",
    canonicalPair: "ETH/AUD",
    exchangePair: "ETHAUD",
    intervalMinutes: 1440,
  },
  {
    basename: "ETHAUD_60.csv",
    canonicalPair: "ETH/AUD",
    exchangePair: "ETHAUD",
    intervalMinutes: 60,
  },
  {
    basename: "XBTAUD_1440.csv",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 1440,
  },
  {
    basename: "XBTAUD_60.csv",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
  },
];

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--archive", "--acquired-at", "--output"].includes(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      values.has(name)
    ) {
      throw new Error(
        "Expected unique --archive, --acquired-at and --output arguments",
      );
    }
    values.set(name, value);
  }
  if (values.size !== 3) {
    throw new Error(
      "Expected unique --archive, --acquired-at and --output arguments",
    );
  }
  return {
    archivePath: values.get("--archive"),
    acquiredAt: values.get("--acquired-at"),
    outputPath: values.get("--output"),
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function collectProcess(command, args, maximumBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumBytes) {
        exceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 65_536) stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (exceeded) {
        reject(new Error(`${command} output exceeded its validation limit`));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(`${command} failed${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

function validateArchivePath(entry) {
  const path = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.includes("\\") ||
    /[*?[\]\u0000-\u001f\u007f]/u.test(path) ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    throw new Error("Archive contains an unsafe entry path");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error("Archive contains an unsafe entry path");
  }
}

function selectMembers(listingText) {
  const entries = listingText.endsWith("\n")
    ? listingText.slice(0, -1).split("\n")
    : listingText.split("\n");
  if (
    entries.length === 0 ||
    entries.length > MAXIMUM_ARCHIVE_ENTRIES ||
    entries.some((entry) => entry.length === 0) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error("Archive entry count is invalid");
  }
  for (const entry of entries) validateArchivePath(entry);

  return REQUIRED_MEMBERS.map((required) => {
    const matches = entries.filter(
      (entry) => entry.split("/").at(-1) === required.basename,
    );
    if (matches.length !== 1) {
      throw new Error(`Archive must contain exactly one ${required.basename}`);
    }
    return { ...required, entryPath: matches[0] };
  });
}

async function captureArchive({ archivePath, acquiredAt }) {
  const archive = await stat(archivePath);
  if (
    !archive.isFile() ||
    !Number.isSafeInteger(archive.size) ||
    archive.size <= 0 ||
    archive.size > MAXIMUM_ARCHIVE_BYTES
  ) {
    throw new Error("Archive size is outside the hosted capture limit");
  }
  const acquiredAtMs = Date.parse(acquiredAt);
  if (
    !Number.isFinite(acquiredAtMs) ||
    new Date(acquiredAtMs).toISOString() !== acquiredAt
  ) {
    throw new Error("acquiredAt must be a canonical ISO-8601 timestamp");
  }

  const archiveSha256 = await sha256File(archivePath);
  const listingBytes = await collectProcess(
    "unzip",
    ["-Z1", archivePath],
    MAXIMUM_LISTING_BYTES,
  );
  const listing = new TextDecoder("utf-8", { fatal: true }).decode(listingBytes);
  const selected = selectMembers(listing);
  const sourceManifest = await buildKrakenHistoricalOhlcvtSourceManifest();
  const members = [];

  for (const member of selected) {
    const csvBytes = await collectProcess(
      "unzip",
      ["-p", archivePath, member.entryPath],
      MAXIMUM_CSV_BYTES,
    );
    const csvText = new TextDecoder("utf-8", { fatal: true }).decode(csvBytes);
    const csvSha256 = bytesToHex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", csvBytes)),
    );
    const prepared = await prepareKrakenHistoricalCsv({
      sourceContractSha256: sourceManifest.contractSha256,
      archiveKind: "complete",
      archiveUrl: KRAKEN_HISTORICAL_OHLCVT_SOURCE.completeArchiveUrl,
      archiveSha256,
      archiveByteLength: archive.size,
      acquiredAt,
      csvMemberName: member.basename,
      csvSha256,
      csvByteLength: csvBytes.length,
      csvText,
      canonicalPair: member.canonicalPair,
      exchangePair: member.exchangePair,
      intervalMinutes: member.intervalMinutes,
    });
    members.push({
      csvMemberName: prepared.csvMemberName,
      csvSha256: prepared.csvSha256,
      csvByteLength: prepared.csvByteLength,
      canonicalPair: prepared.canonicalPair,
      exchangePair: prepared.exchangePair,
      intervalMinutes: prepared.intervalMinutes,
      rowCount: prepared.rowCount,
      firstOpenTimeMs: prepared.firstOpenTimeMs,
      lastOpenTimeMs: prepared.lastOpenTimeMs,
      csvManifestSha256: prepared.csvManifestSha256,
    });
  }

  const manifest = {
    schemaVersion: 1,
    sourceContractSha256: sourceManifest.contractSha256,
    archiveKind: "complete",
    archiveUrl: KRAKEN_HISTORICAL_OHLCVT_SOURCE.completeArchiveUrl,
    archiveSha256,
    archiveByteLength: archive.size,
    acquiredAt,
    members,
  };
  return {
    ...manifest,
    captureManifestSha256: await sha256Hex(JSON.stringify(manifest)),
  };
}

export { captureArchive, selectMembers };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { archivePath, acquiredAt, outputPath } = parseArguments(
    process.argv.slice(2),
  );
  const manifest = await captureArchive({ archivePath, acquiredAt });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${manifest.captureManifestSha256} ${manifest.archiveSha256}\n`,
  );
}
