import { access, copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const appRoot = path.resolve(__dirname, "..");

const requiredCopies = [
  {
    source: path.join(repoRoot, "data", "signals", "latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "digests", "latest.md"),
    dest: path.join(appRoot, "public", "rootfetch", "latest.md"),
  },
];

const optionalCopies = [
  {
    source: path.join(repoRoot, "data", "signals", "sector_indices.csv"),
    dest: path.join(appRoot, "public", "rootfetch", "sector_indices.csv"),
  },
];

async function exists(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyOne(source, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(source, dest);
}

async function main() {
  for (const item of requiredCopies) {
    if (!(await exists(item.source))) {
      throw new Error(
        `Missing required RootFetch artifact: ${path.relative(repoRoot, item.source)}. ` +
          "Run `rootfetch run-daily` before building the web dashboard."
      );
    }
    await copyOne(item.source, item.dest);
    console.log(`synced ${path.relative(repoRoot, item.source)} -> ${path.relative(appRoot, item.dest)}`);
  }

  for (const item of optionalCopies) {
    if (!(await exists(item.source))) {
      console.warn(`optional artifact missing: ${path.relative(repoRoot, item.source)}`);
      continue;
    }
    await copyOne(item.source, item.dest);
    console.log(`synced ${path.relative(repoRoot, item.source)} -> ${path.relative(appRoot, item.dest)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
