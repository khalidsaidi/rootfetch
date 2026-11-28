// RootFetch MCP tools. Everything is read from rootfetch.com's public data files, so the
// same code serves the local stdio package and the hosted endpoint, with no backend to keep alive.
import { domainToASCII } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SERVER_NAME = "rootfetch";
export const SERVER_VERSION = "0.2.1";
const BASE = (process.env.ROOTFETCH_DATA_URL ?? "https://rootfetch.com").replace(/\/$/, "");
const CACHE_MS = 10 * 60 * 1000;

type LatestChange = { added: number; pct: number; days: number; weekly_pct: number } | null;
export type Profile = {
  tld: string; name: string; domains: number; last_checked: string; rank: number;
  first_checked: string; first_domains: number; change_since_first_pct: number | null;
  latest_change: LatestChange; kind: string; operator: string | null; delegated: string | null;
  brand_only: boolean; meaning: string | null; unusual_jumps: number; last_jump: string | null;
  named_in_abuse_reports: boolean; safety: string; country_code: boolean; url: string;
};
type Jump = { tld: string; date: string; prev_date: string; gap_days: number; prev_count: number;
  count: number; added: number; pct: number; severity: string | null; known_abuse: boolean };

const cache = new Map<string, { at: number; value: unknown }>();

async function fetchCached<T>(path: string, parse: (body: string) => T): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const res = await fetch(`${BASE}/${path}`, { headers: { "user-agent": `rootfetch-mcp/${SERVER_VERSION}` } });
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`RootFetch data request failed: ${res.status} for ${path}`);
  const value = parse(await res.text());
  cache.set(path, { at: Date.now(), value });
  return value;
}

class NotFound extends Error {}

async function profiles(): Promise<{ last_update: string; tlds: Profile[] }> {
  return fetchCached("data/tlds.json", (b) => JSON.parse(b));
}

async function jumps(): Promise<Jump[]> {
  return fetchCached("data/spikes.json", (b) => JSON.parse(b).spikes as Jump[]);
}

async function history(tld: string): Promise<{ date: string; domains: number }[]> {
  return fetchCached(`data/tld/${tld}.csv`, (b) =>
    b.trim().split("\n").slice(1).map((line) => {
      const [date, , count] = line.split(",");
      return { date, domains: Number(count) };
    }),
  );
}

/** Accepts ".XYZ", "xyz", "example.xyz" or a Unicode IDN like "сайт"; returns the ASCII TLD. */
export function normalizeTld(input: string): string {
  let t = input.trim().toLowerCase().replace(/^\*?\./, "");
  if (t.includes(".")) t = t.split(".").filter(Boolean).pop() ?? t;
  const ascii = domainToASCII(t);
  return ascii || t;
}

async function findTld(input: string): Promise<Profile> {
  const tld = normalizeTld(input);
  const { tlds } = await profiles();
  const hit = tlds.find((p) => p.tld === tld);
  if (!hit) {
    throw new Error(`.${tld} is not one of the ${tlds.length} extensions RootFetch tracks. ` +
      "Country codes such as .uk or .de don't publish zone files through ICANN, so they aren't covered.");
  }
  return hit;
}

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
const n = (v: number) => v.toLocaleString("en-US");

function profileText(p: Profile): string {
  const lines = [
    `.${p.name}${p.name !== p.tld ? ` (${p.tld})` : ""}: ${n(p.domains)} registered domains on ${p.last_checked}, #${p.rank} by size.`,
    `Type: ${p.kind}${p.operator ? `, run by ${p.operator}` : ""}${p.delegated ? `, in the root zone since ${p.delegated}` : ""}.`,
  ];
  if (p.meaning) lines.push(`Meaning: ${p.meaning}.`);
  if (p.latest_change) {
    lines.push(`Latest change: ${p.latest_change.added >= 0 ? "+" : ""}${n(p.latest_change.added)} domains over ` +
      `${p.latest_change.days} days (${pct(p.latest_change.weekly_pct, 2)} a week).`);
  }
  if (p.change_since_first_pct != null) lines.push(`Since ${p.first_checked}: ${pct(p.change_since_first_pct)}.`);
  lines.push(`Safety: ${p.safety}`);
  lines.push(`Details: ${p.url}`);
  return lines.join("\n");
}

// Every tool only reads RootFetch's own published files on rootfetch.com: nothing is written,
// and no outside source is queried live, so the world is closed.
const readOnly = (title: string) =>
  ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

// Appended to every tool description: where the numbers come from, how fresh they are, what's missing.
const SOURCE = " Source: RootFetch's counts of registered domains in ICANN CZDS zone files. Updated daily; most " +
  "extensions are re-counted about every two weeks, .xyz, .app and .dev daily. Covers ~1,080 generic extensions, " +
  "not .com or country codes such as .uk.";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME, title: "RootFetch", version: SERVER_VERSION, websiteUrl: "https://rootfetch.com/mcp.html",
      icons: [{ src: "https://rootfetch.com/og/logo.png", mimeType: "image/png", sizes: ["512x512"] }],
    },
    {
      instructions:
        "RootFetch counts the registered domains under ~1,080 generic domain extensions (TLDs) from ICANN zone files, " +
        "updated daily. Use it to answer how big or how fast-growing an extension is, who runs it, whether it shows " +
        "abuse signals, and which extensions had sudden registration jumps. It does not cover .com or country codes.",
    },
  );

  server.registerTool(
    "lookup_tld",
    {
      title: "Look up a domain extension",
      description:
        "Profile of one domain extension (TLD): registered domains, size rank, who runs it, when it launched, " +
        "growth, unusual registration jumps and a data-based safety verdict. Accepts '.xyz', 'xyz' or 'example.xyz'." + SOURCE,
      inputSchema: { tld: z.string().min(1).describe("The extension, e.g. '.xyz', 'bond' or 'shop.example.top'") },
      annotations: readOnly("Look up a domain extension"),
    },
    async ({ tld }) => {
      const p = await findTld(tld);
      return { content: [{ type: "text", text: profileText(p) }], structuredContent: { ...p } };
    },
  );

  server.registerTool(
    "rank_tlds",
    {
      title: "Rank domain extensions",
      description:
        "Rank domain extensions by size or by growth at their latest check. Growth is per week so extensions checked " +
        "days or weeks apart compare fairly." + SOURCE,
      inputSchema: {
        by: z.enum(["largest", "fastest_growing", "fastest_shrinking", "biggest_gains"]).default("largest"),
        limit: z.number().int().min(1).max(50).default(10),
        min_domains: z.number().int().min(0).default(10000)
          .describe("Ignore extensions smaller than this (default 10,000) so tiny ones don't dominate growth rankings"),
      },
      annotations: readOnly("Rank domain extensions"),
    },
    async ({ by, limit, min_domains }) => {
      const { tlds, last_update } = await profiles();
      let pool = tlds.filter((p) => p.domains >= min_domains);
      const weekly = (p: Profile) => p.latest_change?.weekly_pct ?? 0;
      const gainPerWeek = (p: Profile) => (p.latest_change ? (p.latest_change.added * 7) / p.latest_change.days : 0);
      if (by === "largest") pool = pool.sort((a, b) => b.domains - a.domains);
      else pool = pool.filter((p) => p.latest_change).sort((a, b) =>
        by === "fastest_growing" ? weekly(b) - weekly(a)
          : by === "fastest_shrinking" ? weekly(a) - weekly(b)
            : gainPerWeek(b) - gainPerWeek(a));
      const rows = pool.slice(0, limit).map((p, i) => ({
        position: i + 1, tld: p.tld, name: p.name, domains: p.domains, weekly_pct: p.latest_change?.weekly_pct ?? null,
        gained_per_week: p.latest_change ? Math.round(gainPerWeek(p)) : null, operator: p.operator,
        last_checked: p.last_checked, url: p.url,
      }));
      const text = [`${by.replace(/_/g, " ")} (data as of ${last_update}):`,
        ...rows.map((r) => `${r.position}. .${r.name}: ${n(r.domains)} domains` +
          (r.weekly_pct != null ? `, ${pct(r.weekly_pct, 2)} a week` : `, last counted ${r.last_checked}`))].join("\n");
      return { content: [{ type: "text", text }], structuredContent: { by, last_update, results: rows } };
    },
  );

  server.registerTool(
    "recent_jumps",
    {
      title: "Recent unusual registration jumps",
      description:
        "Extensions that gained at least 1,000 domains and 5% or more within 21 days, newest first. Such bursts are " +
        "often price promotions and sometimes bulk registrations for spam or phishing." + SOURCE,
      inputSchema: {
        days: z.number().int().min(1).max(365).default(30).describe("How far back to look"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: readOnly("Recent unusual registration jumps"),
    },
    async ({ days, limit }) => {
      const all = await jumps();
      const newest = all.reduce((m, j) => (j.date > m ? j.date : m), "");
      const cutoff = new Date(Date.parse(newest) - days * 86400000).toISOString().slice(0, 10);
      const rows = all.filter((j) => j.date > cutoff).slice(0, limit);
      const text = rows.length
        ? rows.map((j) => `${j.date} .${j.tld}: ${pct(j.pct)} (+${n(j.added)} to ${n(j.count)}) in ${j.gap_days} days` +
            `${j.severity ? `, ${j.severity}` : ""}${j.known_abuse ? ", named in abuse reports" : ""}`).join("\n")
        : `No unusual jumps in the ${days} days before ${newest}.`;
      return { content: [{ type: "text", text }], structuredContent: { days, newest_data: newest, jumps: rows } };
    },
  );

  server.registerTool(
    "compare_tlds",
    {
      title: "Compare domain extensions",
      description: "Side-by-side size, growth, operator and safety for 2 to 10 domain extensions." + SOURCE,
      inputSchema: { tlds: z.array(z.string().min(1)).min(2).max(10).describe("e.g. ['.xyz', '.top', '.shop']") },
      annotations: readOnly("Compare domain extensions"),
    },
    async ({ tlds }: { tlds: string[] }) => {
      const found: Profile[] = await Promise.all(tlds.map((t) => findTld(t)));
      const text = found.map((p) => `.${p.name}: ${n(p.domains)} domains (#${p.rank}), ` +
        (p.latest_change ? `${pct(p.latest_change.weekly_pct, 2)} a week` : `last counted ${p.last_checked}`) +
        `, ${p.operator ?? "unknown operator"}. ${p.safety}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: { results: found } };
    },
  );

  server.registerTool(
    "tld_history",
    {
      title: "Domain count history",
      description: "Every recorded domain count for one extension, oldest first, from RootFetch's daily zone-file checks." + SOURCE,
      inputSchema: { tld: z.string().min(1) },
      annotations: readOnly("Domain count history"),
    },
    async ({ tld }: { tld: string }) => {
      const p = await findTld(tld);
      const points = await history(p.tld);
      const text = `.${p.name}, ${points.length} checks:\n` + points.map((x) => `${x.date}: ${n(x.domains)}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: { tld: p.tld, url: p.url, history: points } };
    },
  );

  return server;
}
