import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  captureArchive,
  selectMembers,
} from "../scripts/capture-kraken-historical-archive.mjs";

const ACQUIRED_AT = "2026-07-29T09:00:00.000Z";
const OPEN_SECONDS = 1_704_067_200;

function csv(intervalMinutes) {
  return [
    `${OPEN_SECONDS},100,105,95,102,101,10,4`,
    `${OPEN_SECONDS + intervalMinutes * 60},102,108,100,107,105,12,5`,
  ].join("\n");
}

function createArchive({ omit } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kraken-history-"));
  const members = join(root, "Kraken_OHLCVT");
  mkdirSync(members);
  for (const [name, interval] of [
    ["ETHAUD_1440.csv", 1440],
    ["ETHAUD_60.csv", 60],
    ["XBTAUD_1440.csv", 1440],
    ["XBTAUD_60.csv", 60],
  ]) {
    if (name !== omit) writeFileSync(join(members, name), csv(interval), "utf8");
  }
  const archive = join(root, "Kraken_OHLCVT.zip");
  execFileSync("zip", ["-q", "-r", archive, "Kraken_OHLCVT"], { cwd: root });
  return { root, archive };
}

test("captures exact archive and four validated member identities", async () => {
  const fixture = createArchive();
  try {
    const manifest = await captureArchive({
      archivePath: fixture.archive,
      acquiredAt: ACQUIRED_AT,
    });
    assert.equal(manifest.members.length, 4);
    assert.deepEqual(
      manifest.members.map((member) => member.csvMemberName),
      [
        "ETHAUD_1440.csv",
        "ETHAUD_60.csv",
        "XBTAUD_1440.csv",
        "XBTAUD_60.csv",
      ],
    );
    assert.ok(manifest.members.every((member) => member.rowCount === 2));
    assert.match(manifest.archiveSha256, /^[0-9a-f]{64}$/u);
    assert.match(manifest.captureManifestSha256, /^[0-9a-f]{64}$/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects missing and unsafe archive membership", async () => {
  const fixture = createArchive({ omit: "ETHAUD_60.csv" });
  try {
    await assert.rejects(
      captureArchive({
        archivePath: fixture.archive,
        acquiredAt: ACQUIRED_AT,
      }),
      /exactly one ETHAUD_60\.csv/u,
    );
    assert.throws(
      () =>
        selectMembers(
          [
            "../ETHAUD_1440.csv",
            "ETHAUD_60.csv",
            "XBTAUD_1440.csv",
            "XBTAUD_60.csv",
          ].join("\n"),
        ),
      /unsafe entry path/u,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI writes a content-addressed manifest without raw candles", () => {
  const fixture = createArchive();
  const output = join(fixture.root, "manifest.json");
  try {
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/capture-kraken-historical-archive.mjs",
        "--archive",
        fixture.archive,
        "--acquired-at",
        ACQUIRED_AT,
        "--output",
        output,
      ],
      { cwd: new URL("..", import.meta.url) },
    );
    const manifest = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(manifest.members.length, 4);
    assert.equal(JSON.stringify(manifest).includes(`${OPEN_SECONDS},100`), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
