// Build guard: every inline <script> on key pages must parse, and the GA4 setup must be intact.
// A broken regex in the analytics block throws a SyntaxError, kills tracking silently, and the
// page still looks perfect, so this runs on every build. Usage: node check_inline_js.mjs <site dir>
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const OUT = process.argv[2] || "_site";
const PAGES = ["index.html", "tlds.html", "spikes.html", "data.html", "about.html", "404.html", "tld/xyz.html", "tld/lol.html"];
const REQUIRED = [
  "gtag/js?id=G-6W6C3JRX1Z",
  "content_group: kind",
  "/^\\/tld\\//.test(p)",                  // page-type regex with its backslashes
  "p.match(/^\\/tld\\/([^\\/.]+)/)",        // TLD slug regex
  "gtag('event', name, p)",
  "send('tld_open'",
  "send('data_download'",
  "send('read_complete'",
];

let failures = 0;
for (const page of PAGES) {
  const file = path.join(OUT, page);
  let html;
  try {
    html = await fs.readFile(file, "utf8");
  } catch {
    console.error(`missing page: ${page}`);
    failures++;
    continue;
  }
  let scripts = 0;
  for (const [, attrs, body] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/application\/ld\+json/.test(attrs)) {
      try { JSON.parse(body); } catch (err) { console.error(`${page}: JSON-LD does not parse — ${err.message}`); failures++; }
      continue;
    }
    scripts++;
    try { new vm.Script(body, { filename: page }); }
    catch (err) { console.error(`${page}: inline script does not parse — ${err.message}`); failures++; }
  }
  for (const needle of REQUIRED) {
    if (!html.includes(needle)) { console.error(`${page}: missing analytics marker ${needle}`); failures++; }
  }
  if (scripts < 3) { console.error(`${page}: expected at least 3 inline scripts, found ${scripts}`); failures++; }
}
if (failures) {
  console.error(`inline script check FAILED (${failures} problem${failures === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log(`inline script check passed: ${PAGES.length} pages`);
