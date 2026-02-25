import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import McpSnippet from "./components/McpSnippet";
import styles from "./page.module.css";

type Mover = {
  tld?: string;
  delta_abs?: number;
  delta_pct?: number;
  count?: number;
};

type RollingUpdate = {
  tld?: string;
  count?: number;
  prev_date_utc?: string;
  days_since_prev?: number;
  delta_abs?: number;
  delta_pct?: number;
  cadence?: string;
  status?: string;
  is_first_seen?: boolean;
};

type Anomaly = {
  tld?: string;
  reason?: string;
  delta_pct?: number;
  z?: number;
  robust_z?: number;
};

type Sector = {
  sector?: string;
  sector_count?: number;
  sector_delta_pct?: number;
};

type TopTld = {
  tld?: string;
  count?: number;
  share_pct?: number;
  sector?: string;
  cadence?: string;
  status?: string;
  is_estimate?: boolean;
};

type Distribution = {
  p50?: number;
  p90?: number;
  p99?: number;
  max?: number;
  min?: number;
  tiny_tlds_lt_100?: number;
  small_tlds_lt_1000?: number;
  tiny_lt_100?: number;
  small_lt_1000?: number;
};

type Concentration = {
  top1_share_pct?: number;
  top3_share_pct?: number;
  top10_share_pct?: number;
  hhi?: number;
};

type ApprovalsDiff = {
  prev_date_utc?: string;
  added_count?: number;
  removed_count?: number;
  added_preview?: string[];
  added_first_10?: string[];
  added?: string[];
};

type LatestSignals = {
  date_utc: string;
  run_id: string;
  approved_tlds_count: number;
  counted_today_count?: number;
  counted_today_core_count?: number;
  counted_today_rolling_count?: number;
  snapshot_rows_today?: number;
  processed_tlds_count_today?: number;
  coverage_pct_today?: number;
  note_if_partial?: string;
  total_delegated_domains_today?: number;
  total_delegated_counted_today?: number;
  top_tlds?: TopTld[];
  distribution?: Distribution;
  concentration?: Concentration;
  approvals_diff?: ApprovalsDiff;
  top_movers_abs: Mover[];
  top_movers_pct: Mover[];
  top_decliners_abs: Mover[];
  core_movers_abs?: Mover[];
  core_movers_pct?: Mover[];
  rolling_updates?: RollingUpdate[];
  anomalies: Anomaly[];
  sector_snapshot: Sector[];
};

type CoverageLatest = {
  date_utc: string;
  approved_tlds_count: number;
  approved_tlds: string[];
  counted_today_tlds: string[];
  counted_today_count: number;
  counted_today_core_count?: number;
  counted_today_rolling_count?: number;
  counted_ever_tlds: string[];
  counted_ever_count: number;
  missing_ever_tlds: string[];
  missing_ever_count: number;
};

const EMPTY_SIGNALS: LatestSignals = {
  date_utc: "n/a",
  run_id: "n/a",
  approved_tlds_count: 0,
  counted_today_count: 0,
  counted_today_core_count: 0,
  counted_today_rolling_count: 0,
  snapshot_rows_today: 0,
  processed_tlds_count_today: 0,
  coverage_pct_today: 0,
  note_if_partial: "",
  total_delegated_domains_today: 0,
  total_delegated_counted_today: 0,
  top_tlds: [],
  distribution: {},
  concentration: {},
  approvals_diff: {},
  top_movers_abs: [],
  top_movers_pct: [],
  top_decliners_abs: [],
  core_movers_abs: [],
  core_movers_pct: [],
  rolling_updates: [],
  anomalies: [],
  sector_snapshot: [],
};

const EMPTY_COVERAGE: CoverageLatest = {
  date_utc: "n/a",
  approved_tlds_count: 0,
  approved_tlds: [],
  counted_today_tlds: [],
  counted_today_count: 0,
  counted_today_core_count: 0,
  counted_today_rolling_count: 0,
  counted_ever_tlds: [],
  counted_ever_count: 0,
  missing_ever_tlds: [],
  missing_ever_count: 0,
};

const EMPTY_DISTRIBUTION: Distribution = {};
const EMPTY_CONCENTRATION: Concentration = {};
const EMPTY_APPROVALS_DIFF: ApprovalsDiff = {};

function fmtInt(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtRatioPct(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function fmtPctPoints(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function parseCsvRecord(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

async function loadLatestSignals(): Promise<LatestSignals> {
  const latestPath = path.join(process.cwd(), "public", "rootfetch", "latest.json");
  try {
    const payload = await fs.readFile(latestPath, "utf-8");
    const parsed = JSON.parse(payload) as Partial<LatestSignals>;
    return {
      ...EMPTY_SIGNALS,
      ...parsed,
      top_tlds: parsed.top_tlds ?? [],
      distribution: parsed.distribution ?? {},
      concentration: parsed.concentration ?? {},
      approvals_diff: parsed.approvals_diff ?? {},
      top_movers_abs: parsed.top_movers_abs ?? [],
      top_movers_pct: parsed.top_movers_pct ?? [],
      top_decliners_abs: parsed.top_decliners_abs ?? [],
      core_movers_abs: parsed.core_movers_abs ?? parsed.top_movers_abs ?? [],
      core_movers_pct: parsed.core_movers_pct ?? parsed.top_movers_pct ?? [],
      rolling_updates: parsed.rolling_updates ?? [],
      anomalies: parsed.anomalies ?? [],
      sector_snapshot: parsed.sector_snapshot ?? [],
    };
  } catch {
    return EMPTY_SIGNALS;
  }
}

async function loadCoverage(): Promise<CoverageLatest> {
  const coveragePath = path.join(process.cwd(), "public", "rootfetch", "coverage_latest.json");
  try {
    const payload = await fs.readFile(coveragePath, "utf-8");
    const parsed = JSON.parse(payload) as Partial<CoverageLatest>;
    return {
      ...EMPTY_COVERAGE,
      ...parsed,
      approved_tlds: parsed.approved_tlds ?? [],
      counted_today_tlds: parsed.counted_today_tlds ?? [],
      counted_ever_tlds: parsed.counted_ever_tlds ?? [],
      missing_ever_tlds: parsed.missing_ever_tlds ?? [],
    };
  } catch {
    return EMPTY_COVERAGE;
  }
}

async function loadTopTldsCsv(): Promise<TopTld[]> {
  const csvPath = path.join(process.cwd(), "public", "rootfetch", "top_tlds_latest.csv");
  try {
    const raw = await fs.readFile(csvPath, "utf-8");
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return [];
    }
    const header = parseCsvRecord(lines[0]);
    const idx = Object.fromEntries(header.map((name, i) => [name, i]));
    const rows: TopTld[] = [];
    for (const line of lines.slice(1)) {
      const fields = parseCsvRecord(line);
      rows.push({
        tld: fields[idx.tld] ?? "",
        count: Number(fields[idx.count] ?? ""),
        share_pct: Number(fields[idx.share_pct] ?? ""),
        sector: fields[idx.sector] ?? "",
        cadence: fields[idx.cadence] ?? "",
        status: fields[idx.status] ?? "",
      });
    }
    return rows.filter((row) => row.tld);
  } catch {
    return [];
  }
}

async function loadDistribution(): Promise<Distribution> {
  const filePath = path.join(process.cwd(), "public", "rootfetch", "distribution_latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as Distribution;
  } catch {
    return EMPTY_DISTRIBUTION;
  }
}

async function loadConcentration(): Promise<Concentration> {
  const filePath = path.join(process.cwd(), "public", "rootfetch", "concentration_latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as Concentration;
  } catch {
    return EMPTY_CONCENTRATION;
  }
}

async function loadApprovalsDiff(): Promise<ApprovalsDiff> {
  const filePath = path.join(process.cwd(), "public", "rootfetch", "approvals_diff_latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ApprovalsDiff;
    const addedList = Array.isArray(parsed.added) ? parsed.added : [];
    const firstTen = Array.isArray(parsed.added_first_10) ? parsed.added_first_10 : [];
    const preview = Array.isArray(parsed.added_preview) && parsed.added_preview.length > 0
      ? parsed.added_preview
      : firstTen.length > 0
        ? firstTen
      : addedList.slice(0, 10);
    return {
      ...parsed,
      added_preview: preview,
      added: addedList,
    };
  } catch {
    return EMPTY_APPROVALS_DIFF;
  }
}

async function loadDigestSnippet(): Promise<string> {
  const digestPath = path.join(process.cwd(), "public", "rootfetch", "latest.md");
  try {
    const raw = await fs.readFile(digestPath, "utf-8");
    return raw
      .split("\n")
      .slice(0, 20)
      .join("\n")
      .trim();
  } catch {
    return "Latest digest is unavailable. Run `rootfetch run-baseline --resume` or `rootfetch run-hybrid` first.";
  }
}

function MoverList({ title, items }: { title: string; items: Mover[] }) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>Top movers appear after we have yesterday&apos;s baseline.</p>
      ) : (
        <ul className={styles.rankList}>
          {items.slice(0, 8).map((item) => (
            <li key={`${title}-${item.tld}-${item.delta_abs}`}>
              <span className={styles.tld}>{item.tld ?? "unknown"}</span>
              <span>{fmtInt(item.delta_abs)}</span>
              <span>{fmtRatioPct(item.delta_pct)}</span>
              <span>{fmtInt(item.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RollingList({ items }: { items: RollingUpdate[] }) {
  const firstSeenCount = items.filter((item) => !item.prev_date_utc || item.is_first_seen).length;
  return (
    <section className={styles.panel}>
      <h2>Rolling Updates</h2>
      {firstSeenCount > 0 ? (
        <p className={styles.panelSub}>First observations today: {fmtInt(firstSeenCount)}</p>
      ) : null}
      {items.length === 0 ? (
        <p className={styles.empty}>No rolling updates or first-seen rows for this run.</p>
      ) : (
        <ul className={styles.rankList}>
          {items.slice(0, 8).map((item) => {
            const isFirstSeen = !item.prev_date_utc || item.is_first_seen;
            return (
              <li key={`${item.tld}-${item.prev_date_utc}-${item.delta_abs}`}>
                <span className={styles.tld}>{item.tld ?? "unknown"}</span>
                <span>{isFirstSeen ? "First seen today (baseline)" : item.prev_date_utc}</span>
                <span>{isFirstSeen ? "new" : typeof item.days_since_prev === "number" ? `${item.days_since_prev}d` : "n/a"}</span>
                <span>{isFirstSeen ? "n/a" : fmtInt(item.delta_abs)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TopTldsTable({ items }: { items: TopTld[] }) {
  return (
    <article className={styles.panel}>
      <h2>Top TLDs by size</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No cross-sectional ranking available yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>TLD</th>
              <th>Count</th>
              <th>Share</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 20).map((item, idx) => (
              <tr key={`${item.tld}-${idx}`}>
                <td>{idx + 1}</td>
                <td className={styles.tld}>{item.tld ?? "n/a"}</td>
                <td>{fmtInt(item.count)}</td>
                <td>{fmtPctPoints(item.share_pct)}</td>
                <td>{item.sector || "other"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

export default async function Home() {
  const [latest, coverage, digestSnippet, topTldsFallback, distributionFallback, concentrationFallback, approvalsDiffFallback] = await Promise.all([
    loadLatestSignals(),
    loadCoverage(),
    loadDigestSnippet(),
    loadTopTldsCsv(),
    loadDistribution(),
    loadConcentration(),
    loadApprovalsDiff(),
  ]);

  const approvedCount = coverage.approved_tlds_count || latest.approved_tlds_count;
  const observedToday = latest.counted_today_count ?? 0;
  const countedCore = latest.counted_today_core_count ?? coverage.counted_today_core_count ?? 0;
  const countedRolling = latest.counted_today_rolling_count ?? coverage.counted_today_rolling_count ?? 0;
  const snapshotRowsToday = latest.snapshot_rows_today ?? latest.processed_tlds_count_today ?? coverage.counted_today_count ?? 0;
  const countedEver = coverage.counted_ever_count ?? 0;
  const missingEver = coverage.missing_ever_count ?? Math.max(0, approvedCount - countedEver);
  const coveragePct =
    typeof latest.coverage_pct_today === "number"
      ? latest.coverage_pct_today
      : approvedCount > 0
        ? observedToday / approvedCount
        : 0;

  const coreAbs = latest.core_movers_abs ?? latest.top_movers_abs;
  const corePct = latest.core_movers_pct ?? latest.top_movers_pct;
  const rollingUpdates = latest.rolling_updates ?? [];
  const topTlds = (latest.top_tlds && latest.top_tlds.length > 0 ? latest.top_tlds : topTldsFallback) ?? [];
  const distribution: Distribution = { ...distributionFallback, ...(latest.distribution ?? {}) };
  const concentration: Concentration = { ...concentrationFallback, ...(latest.concentration ?? {}) };
  const approvalsDiff: ApprovalsDiff = { ...approvalsDiffFallback, ...(latest.approvals_diff ?? {}) };
  const approvalsAdded = approvalsDiff.added_preview ?? [];
  const totalDelegated = latest.total_delegated_counted_today ?? latest.total_delegated_domains_today;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>RootFetch Daily Dashboard</p>
        <h1>Hybrid delegation signals from committed aggregates</h1>
        <p className={styles.subtitle}>
          Ingestion runs on your local machine (day-1 full baseline, then core daily + rolling long tail). Vercel serves read-only artifacts.
        </p>

        <div className={styles.metaGrid}>
          <article>
            <p>Latest date (UTC)</p>
            <strong>{latest.date_utc}</strong>
          </article>
          <article>
            <p>Approved TLDs</p>
            <strong>{fmtInt(approvedCount)}</strong>
          </article>
          <article>
            <p>Observed today</p>
            <strong>{fmtInt(observedToday)}</strong>
          </article>
          <article>
            <p>Snapshot rows today</p>
            <strong>{fmtInt(snapshotRowsToday)}</strong>
          </article>
          <article>
            <p>Counted ever</p>
            <strong>{fmtInt(countedEver)}</strong>
          </article>
          <article>
            <p>Missing ever</p>
            <strong>{fmtInt(missingEver)}</strong>
          </article>
          <article>
            <p>Core counted today</p>
            <strong>{fmtInt(countedCore)}</strong>
          </article>
          <article>
            <p>Rolling counted today</p>
            <strong>{fmtInt(countedRolling)}</strong>
          </article>
          <article>
            <p>Observed coverage today</p>
            <strong>{fmtRatioPct(coveragePct)}</strong>
          </article>
          <article>
            <p>Total delegated counted today</p>
            <strong>{fmtInt(totalDelegated)}</strong>
          </article>
          <article>
            <p>Run ID</p>
            <strong className={styles.mono}>{latest.run_id}</strong>
          </article>
        </div>

        {latest.note_if_partial ? <p className={styles.note}>{latest.note_if_partial}</p> : null}

        <div className={styles.links}>
          <Link href="/approved">Approved TLDs</Link>
          <Link href="/rootfetch/latest.md">Read digest</Link>
          <Link href="/api/latest">JSON API</Link>
          <Link href="/api/mcp">MCP endpoint</Link>
          <Link href="/about">About metrics</Link>
        </div>

        <div className={styles.mcpBox}>
          <p>
            MCP endpoint: <code>/api/mcp</code>
          </p>
          <McpSnippet siteUrl={process.env.NEXT_PUBLIC_SITE_URL} />
        </div>
      </section>

      <section className={styles.marketSection}>
        <h2 className={styles.sectionHeading}>Market Structure</h2>
        <div className={styles.grid2}>
        <TopTldsTable items={topTlds} />
        <article className={styles.panel}>
          <h2>Distribution</h2>
          <div className={styles.metricTiles}>
            <div>
              <p>Median (p50)</p>
              <strong>{fmtInt(distribution.p50)}</strong>
            </div>
            <div>
              <p>p90</p>
              <strong>{fmtInt(distribution.p90)}</strong>
            </div>
            <div>
              <p>p99</p>
              <strong>{fmtInt(distribution.p99)}</strong>
            </div>
            <div>
              <p>Tiny (&lt;100)</p>
              <strong>{fmtInt(distribution.tiny_tlds_lt_100 ?? distribution.tiny_lt_100)}</strong>
            </div>
          </div>

          <h3 className={styles.subHeading}>Concentration</h3>
          <div className={styles.metricTiles}>
            <div>
              <p>Top 1 share</p>
              <strong>{fmtPctPoints(concentration.top1_share_pct)}</strong>
            </div>
            <div>
              <p>Top 3 share</p>
              <strong>{fmtPctPoints(concentration.top3_share_pct)}</strong>
            </div>
            <div>
              <p>Top 10 share</p>
              <strong>{fmtPctPoints(concentration.top10_share_pct)}</strong>
            </div>
            <div>
              <p>HHI</p>
              <strong>{typeof concentration.hhi === "number" ? concentration.hhi.toFixed(4) : "n/a"}</strong>
            </div>
          </div>

          <div className={styles.approvalsBox}>
            <h3 className={styles.subHeading}>New approvals today</h3>
            <p className={styles.approvalsTitle}>+{fmtInt(approvalsDiff.added_count)} / -{fmtInt(approvalsDiff.removed_count)}</p>
            {approvalsAdded.length > 0 ? (
              <p className={styles.approvalsList}>{approvalsAdded.slice(0, 10).join(", ")}</p>
            ) : (
              <p className={styles.empty}>No newly approved TLDs in this snapshot diff.</p>
            )}
          </div>
        </article>
        </div>
      </section>

      <section className={styles.grid3}>
        <MoverList title="Core Daily Movers (abs)" items={coreAbs} />
        <MoverList title="Core Daily Movers (pct)" items={corePct} />
        <RollingList items={rollingUpdates} />
      </section>

      <section className={styles.grid2}>
        <article className={styles.panel}>
          <h2>Sector snapshot</h2>
          {latest.sector_snapshot.length === 0 ? (
            <p className={styles.empty}>No sector data available yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th>Count</th>
                  <th>Delta %</th>
                </tr>
              </thead>
              <tbody>
                {latest.sector_snapshot.map((row) => (
                  <tr key={row.sector}>
                    <td>{row.sector ?? "other"}</td>
                    <td>{fmtInt(row.sector_count)}</td>
                    <td>{fmtRatioPct(row.sector_delta_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className={styles.panel}>
          <h2>Anomalies</h2>
          {latest.anomalies.length === 0 ? (
            <p className={styles.empty}>No anomalies flagged for this run.</p>
          ) : (
            <ul className={styles.anomalyList}>
              {latest.anomalies.slice(0, 10).map((item) => (
                <li key={`${item.tld}-${item.reason}`}>
                  <div>
                    <strong>{item.tld ?? "unknown"}</strong>
                    <span>{item.reason ?? "n/a"}</span>
                  </div>
                  <div>
                    <span>{fmtRatioPct(item.delta_pct)}</span>
                    <span>z:{typeof item.z === "number" ? item.z.toFixed(2) : "n/a"}</span>
                    <span>rz:{typeof item.robust_z === "number" ? item.robust_z.toFixed(2) : "n/a"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Digest preview</h2>
        <pre className={styles.digest}>{digestSnippet}</pre>
      </section>
    </main>
  );
}
