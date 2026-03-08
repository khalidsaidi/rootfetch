import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { createFsTransport, createHttpTransport } from "./transport.js";

const decoder = new TextDecoder("utf-8");

export const CANONICAL_RUN_FILES = Object.freeze([
  "coverage_latest.json",
  "model_latest.json",
  "treemap_latest.json",
  "radar_latest.json",
  "signals_latest.json",
  "digest_latest.txt",
  "rag/index.json",
  "rag/chunks.jsonl"
]);

function decodeUtf8(bytes) {
  return decoder.decode(bytes);
}

function parseArtifact(relativePath, bytes) {
  if (relativePath.endsWith(".json")) {
    return JSON.parse(decodeUtf8(bytes));
  }
  if (relativePath.endsWith(".txt") || relativePath.endsWith(".jsonl")) {
    return decodeUtf8(bytes);
  }
  return bytes;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonBytes(relativePath, bytes) {
  try {
    return JSON.parse(decodeUtf8(bytes));
  } catch (error) {
    throw new Error(`Invalid JSON at ${relativePath}: ${error.message}`);
  }
}

function ensureRunId(runId) {
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new Error("run_id must be a non-empty string.");
  }
  return runId;
}

export class RootFetch {
  constructor({ baseUrl = "https://rootfetch.com", transport } = {}) {
    this.transport = transport ?? createHttpTransport({ baseUrl });
  }

  async latest() {
    return this.#readJson("latest.json");
  }

  async replay() {
    return this.#readJson("replay/index.json");
  }

  async run(runId) {
    const safeRunId = ensureRunId(runId);
    const manifestPath = `runs/${safeRunId}/manifest.json`;
    const manifest = await this.#readJson(manifestPath);
    const manifestPaths = new Set((manifest.files ?? []).map((entry) => entry.path));

    const missingCanonical = CANONICAL_RUN_FILES.filter((item) => !manifestPaths.has(item));
    if (missingCanonical.length > 0) {
      throw new Error(`Run ${safeRunId} missing canonical artifacts in manifest: ${missingCanonical.join(", ")}`);
    }

    const artifacts = {};
    for (const relativePath of CANONICAL_RUN_FILES) {
      const bytes = await this.transport.getBytes(`runs/${safeRunId}/${relativePath}`);
      artifacts[relativePath] = parseArtifact(relativePath, bytes);
    }

    return {
      run_id: safeRunId,
      manifest,
      artifacts
    };
  }

  async verifyManifest(runId) {
    const safeRunId = ensureRunId(runId);
    const manifest = await this.#readJson(`runs/${safeRunId}/manifest.json`);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const missingFiles = [];
    const mismatchedFiles = [];
    let checkedCount = 0;

    for (const entry of files) {
      const relativePath = entry?.path;
      const expectedSha = String(entry?.sha256 ?? "").toLowerCase();
      if (!relativePath || !expectedSha) {
        missingFiles.push(String(relativePath ?? ""));
        continue;
      }

      try {
        const bytes = await this.transport.getBytes(`runs/${safeRunId}/${relativePath}`);
        const actualSha = sha256Hex(bytes);
        checkedCount += 1;
        if (actualSha !== expectedSha) {
          mismatchedFiles.push({
            path: relativePath,
            expected_sha256: expectedSha,
            actual_sha256: actualSha
          });
        }
      } catch (_error) {
        missingFiles.push(relativePath);
      }
    }

    return {
      run_id: safeRunId,
      valid: missingFiles.length === 0 && mismatchedFiles.length === 0,
      expected_count: files.length,
      checked_count: checkedCount,
      checked_files: checkedCount,
      missing_files: missingFiles,
      mismatched_files: mismatchedFiles
    };
  }

  async #readJson(relativePath) {
    const bytes = await this.transport.getBytes(relativePath);
    return parseJsonBytes(relativePath, bytes);
  }
}

export { createFsTransport, createHttpTransport };
