import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { CANONICAL_RUN_FILES, RootFetch, createFsTransport } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_ROOT = path.resolve(__dirname, "../../../data/artifacts");

function createClient(rootDir) {
  return new RootFetch({
    transport: createFsTransport({ rootDir })
  });
}

test("latest() returns required pointer fields", async () => {
  const rf = createClient(ARTIFACTS_ROOT);
  const latest = await rf.latest();
  assert.equal(typeof latest.run_id, "string");
  assert.ok(latest.run_id.length > 0);
  assert.equal(typeof latest.model_version, "string");
  assert.equal(typeof latest.snapshot_hash, "string");
  assert.equal(typeof latest.snapshot_ts_utc, "string");
});

test("run() returns canonical artifact set", async () => {
  const rf = createClient(ARTIFACTS_ROOT);
  const latest = await rf.latest();
  const bundle = await rf.run(latest.run_id);

  assert.equal(bundle.run_id, latest.run_id);
  assert.equal(typeof bundle.manifest, "object");
  assert.deepEqual(Object.keys(bundle.artifacts).sort(), [...CANONICAL_RUN_FILES].sort());
  assert.equal(typeof bundle.artifacts["coverage_latest.json"], "object");
  assert.equal(typeof bundle.artifacts["model_latest.json"], "object");
  assert.equal(typeof bundle.artifacts["digest_latest.txt"], "string");
  assert.equal(typeof bundle.artifacts["rag/chunks.jsonl"], "string");
});

test("verifyManifest() passes on committed artifacts", async () => {
  const rf = createClient(ARTIFACTS_ROOT);
  const latest = await rf.latest();
  const result = await rf.verifyManifest(latest.run_id);

  assert.equal(result.valid, true);
  assert.equal(result.expected_count > 0, true);
  assert.equal(result.checked_count, result.expected_count);
  assert.equal(result.checked_files, result.checked_count);
  assert.deepEqual(result.missing_files, []);
  assert.deepEqual(result.mismatched_files, []);
});

test("verifyManifest() fails when a file is tampered", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "rootfetch-sdk-js-"));
  const copiedArtifacts = path.join(sandbox, "artifacts");
  await cp(ARTIFACTS_ROOT, copiedArtifacts, { recursive: true });

  const rf = createClient(copiedArtifacts);
  const latest = await rf.latest();
  const tamperedPath = path.join(copiedArtifacts, "runs", latest.run_id, "coverage_latest.json");

  const original = await readFile(tamperedPath);
  const mutated = Buffer.from(original);
  mutated[0] = mutated[0] === 0x7b ? 0x5b : 0x7b;
  await writeFile(tamperedPath, mutated);

  const result = await rf.verifyManifest(latest.run_id);
  assert.equal(result.valid, false);
  assert.equal(result.checked_count, result.expected_count);
  assert.equal(
    result.mismatched_files.some((entry) => entry.path === "coverage_latest.json"),
    true
  );
});
