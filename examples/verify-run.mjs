#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { RootFetch, createFsTransport } from "../packages/rootfetch-sdk-js/src/index.js";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: node examples/verify-run.mjs <run_id>");
  process.exit(2);
}

const artifactsRoot = path.resolve(process.cwd(), "data", "artifacts");
const rf = new RootFetch({
  transport: createFsTransport({ rootDir: artifactsRoot }),
});

const result = await rf.verifyManifest(runId);
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);

