import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
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

type LatestSignals = {
  date_utc: string;
  run_id: string;
  approved_tlds_count: number;
  counted_today_count?: number;
  counted_today_core_count?: number;
  counted_today_rolling_count?: number;
  processed_tlds_count_today?: number;
  coverage_pct_today?: number;
  note_if_partial?: string;
  total_delegated_domains_today?: number;
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
  processed_tlds_count_today: 0,
  coverage_pct_today: 0,
  note_if_partial: "",
  total_delegated_domains_today: 0,
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

function fmtInt(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

async function loadLatestSignals(): Promise<LatestSignals> {
  const latestPath = path.join(process.cwd(), "public", "rootfetch", "latest.json");
  try {
    const payload = await fs.readFile(latestPath, "utf-8");
    const parsed = JSON.parse(payload) as Partial<LatestSignals>;
    return {
      ...EMPTY_SIGNALS,
      ...parsed,
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
    return "Latest digest is unavailable. Run `rootfetch run-hybrid` first.";
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
              <span>{fmtPct(item.delta_pct)}</span>
              <span>{fmtInt(item.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RollingList({ items }: { items: RollingUpdate[] }) {
  return (
    <section className={styles.panel}>
      <h2>Rolling Updates (Since Last Seen)</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No rolling updates for this run.</p>
      ) : (
        <ul className={styles.rankList}>
          {items.slice(0, 8).map((item) => (
            <li key={`${item.tld}-${item.prev_date_utc}-${item.delta_abs}`}>
              <span className={styles.tld}>{item.tld ?? "unknown"}</span>
              <span>{item.prev_date_utc ?? "n/a"}</span>
              <span>{typeof item.days_since_prev === "number" ? `${item.days_since_prev}d` : "n/a"}</span>
              <span>{fmtInt(item.delta_abs)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function Home() {
  const [latest, coverage, digestSnippet] = await Promise.all([
    loadLatestSignals(),
    loadCoverage(),
    loadDigestSnippet(),
  ]);

  const approvedCount = coverage.approved_tlds_count || latest.approved_tlds_count;
  const countedToday = latest.counted_today_count ?? coverage.counted_today_count ?? latest.processed_tlds_count_today ?? 0;
  const countedCore = latest.counted_today_core_count ?? coverage.counted_today_core_count ?? 0;
  const countedRolling = latest.counted_today_rolling_count ?? coverage.counted_today_rolling_count ?? 0;
  const coveragePct =
    typeof latest.coverage_pct_today === "number"
      ? latest.coverage_pct_today
      : approvedCount > 0
        ? countedToday / approvedCount
        : 0;

  const coreAbs = latest.core_movers_abs ?? latest.top_movers_abs;
  const corePct = latest.core_movers_pct ?? latest.top_movers_pct;
  const rollingUpdates = latest.rolling_updates ?? [];

  const mcpSnippet = `{
  "mcpServers": {
    "rootfetch": { "url": "https://<vercel-domain>/api/mcp" }
  }
}`;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>RootFetch Daily Dashboard</p>
        <h1>Hybrid delegation signals from committed aggregates</h1>
        <p className={styles.subtitle}>
          Ingestion runs on your local machine (core daily + rolling long tail). Vercel serves read-only artifacts.
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
            <p>Counted today</p>
            <strong>{fmtInt(countedToday)}</strong>
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
            <p>Coverage today</p>
            <strong>{fmtPct(coveragePct)}</strong>
          </article>
          <article>
            <p>Total delegated counted today</p>
            <strong>{fmtInt(latest.total_delegated_domains_today)}</strong>
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
          <pre className={styles.codeBlock}>{mcpSnippet}</pre>
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
                    <td>{fmtPct(row.sector_delta_pct)}</td>
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
                    <span>{fmtPct(item.delta_pct)}</span>
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
