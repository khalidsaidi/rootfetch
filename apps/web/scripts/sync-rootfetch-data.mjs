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
  {
    source: path.join(repoRoot, "data", "approved_tlds", "latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "approved_latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "signals", "coverage_latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "coverage_latest.json"),
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
    const sourceExists = await exists(item.source);
    if (!sourceExists) {
      const destExists = await exists(item.dest);
      if (destExists) {
        console.warn(
          `source missing, keeping existing synced artifact: ${path.relative(appRoot, item.dest)}`
        );
        continue;
      }
      throw new Error(
        `Missing required RootFetch artifact: ${path.relative(repoRoot, item.source)}. ` +
          `Expected source or existing destination ${path.relative(appRoot, item.dest)}.`
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
