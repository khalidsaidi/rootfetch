import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
  {
    source: path.join(repoRoot, "data", "signals", "top_tlds_latest.csv"),
    dest: path.join(appRoot, "public", "rootfetch", "top_tlds_latest.csv"),
  },
  {
    source: path.join(repoRoot, "data", "signals", "distribution_latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "distribution_latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "signals", "concentration_latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "concentration_latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "signals", "approvals_diff_latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "approvals_diff_latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "signals", "security_status_latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "security_status_latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "rag", "rag_chunks.json"),
    dest: path.join(appRoot, "public", "rootfetch", "rag_chunks.json"),
  },
  {
    source: path.join(repoRoot, "data", "rag", "rag_meta.json"),
    dest: path.join(appRoot, "public", "rootfetch", "rag_meta.json"),
  },
];

const optionalCopies = [
  {
    source: path.join(repoRoot, "data", "signals", "sector_indices.csv"),
    dest: path.join(appRoot, "public", "rootfetch", "sector_indices.csv"),
  },
  {
    source: path.join(repoRoot, "data", "growth_trends.csv"),
    dest: path.join(appRoot, "public", "rootfetch", "growth_trends.csv"),
  },
  {
    source: path.join(repoRoot, "data", "artifacts", "latest.json"),
    dest: path.join(appRoot, "public", "rootfetch", "artifacts", "latest.json"),
  },
  {
    source: path.join(repoRoot, "data", "artifacts", "replay", "index.json"),
    dest: path.join(appRoot, "public", "rootfetch", "artifacts", "replay", "index.json"),
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

async function copyDirRecursive(sourceDir, destDir) {
  const sourceStats = await stat(sourceDir);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Expected directory: ${sourceDir}`);
  }
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dst);
    } else if (entry.isFile()) {
      await copyOne(src, dst);
    }
  }
}

function normalizeSiteUrl(raw) {
  return (raw || "https://rootfetch.vercel.app").trim().replace(/\/+$/, "");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseCsvTlds(csvText, limit) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length <= 1) {
    return [];
  }
  const header = lines[0].split(",");
  const tldIndex = header.indexOf("tld");
  if (tldIndex < 0) {
    return [];
  }
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const tld = (cols[tldIndex] || "").trim();
    if (!tld) continue;
    out.push(tld);
    if (out.length >= limit) break;
  }
  return out;
}

async function generateSeoTextArtifacts() {
  const siteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const publicDir = path.join(appRoot, "public");
  const rootfetchPublicDir = path.join(publicDir, "rootfetch");
  const latest = await readJsonOrDefault(path.join(rootfetchPublicDir, "latest.json"), {});
  const topTldsCsv = await readFile(path.join(rootfetchPublicDir, "top_tlds_latest.csv"), "utf-8").catch(
    () => ""
  );
  const topTlds = parseCsvTlds(topTldsCsv, 200);
  const lastmod = new Date().toISOString();

  const baseRoutes = ["/", "/approved", "/about", "/methodology", "/security", "/sectors", "/compare", "/ask", "/recipes", "/docs/mcp"];
  const urls = [...baseRoutes, ...topTlds.map((tld) => `/tld/${encodeURIComponent(tld)}`)];
  const sitemapBody = urls
    .map((route) => `  <url><loc>${escapeXml(`${siteUrl}${route}`)}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("\n");
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${sitemapBody}\n` +
    `</urlset>\n`;

  const robotsTxt =
    `User-agent: *\n` +
    `Allow: /\n` +
    `Disallow: /api/\n` +
    `\n` +
    `Sitemap: ${siteUrl}/sitemap.xml\n` +
    `Host: ${new URL(siteUrl).host}\n`;

  const llmsTxt =
    `# RootFetch\n\n` +
    `RootFetch provides read-only delegation analytics from locally ingested CZDS zone data.\n\n` +
    `## Public artifacts\n` +
    `- ${siteUrl}/rootfetch/latest.json\n` +
    `- ${siteUrl}/rootfetch/top_tlds_latest.csv\n` +
    `- ${siteUrl}/rootfetch/distribution_latest.json\n` +
    `- ${siteUrl}/rootfetch/concentration_latest.json\n` +
    `- ${siteUrl}/rootfetch/security_status_latest.json\n` +
    `- ${siteUrl}/rootfetch/coverage_latest.json\n` +
    `- ${siteUrl}/rootfetch/latest.md\n\n` +
    `## Metric definitions\n` +
    `- approved_tlds_count: approved TLDs visible in latest discovery snapshot\n` +
    `- counted_today_count: observed today (core+rolling)\n` +
    `- snapshot_rows_today: rows present in today's snapshot\n` +
    `- counted_ever_count: approved TLDs observed at least once historically\n` +
    `- missing_ever_count: approved - counted_ever\n` +
    `- top*_share_pct and hhi: concentration metrics\n` +
    `${latest?.date_utc ? `\nCurrent snapshot date: ${latest.date_utc}\n` : ""}`;

  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "sitemap.xml"), sitemapXml, "utf-8");
  await writeFile(path.join(publicDir, "robots.txt"), robotsTxt, "utf-8");
  await writeFile(path.join(publicDir, "llms.txt"), llmsTxt, "utf-8");
  console.log("generated public/sitemap.xml");
  console.log("generated public/robots.txt");
  console.log("generated public/llms.txt");
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

  const artifactsRunsSource = path.join(repoRoot, "data", "artifacts", "runs");
  const artifactsRunsDest = path.join(appRoot, "public", "rootfetch", "artifacts", "runs");
  if (await exists(artifactsRunsSource)) {
    await copyDirRecursive(artifactsRunsSource, artifactsRunsDest);
    console.log(
      `synced ${path.relative(repoRoot, artifactsRunsSource)} -> ${path.relative(appRoot, artifactsRunsDest)}`
    );
  } else {
    console.warn(`optional artifact directory missing: ${path.relative(repoRoot, artifactsRunsSource)}`);
  }

  await generateSeoTextArtifacts();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
