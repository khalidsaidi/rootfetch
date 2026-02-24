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
  top_movers_abs: Mover[];
  top_movers_pct: Mover[];
  top_decliners_abs: Mover[];
  anomalies: Anomaly[];
  sector_snapshot: Sector[];
};

const EMPTY_SIGNALS: LatestSignals = {
  date_utc: "n/a",
  run_id: "n/a",
  approved_tlds_count: 0,
  top_movers_abs: [],
  top_movers_pct: [],
  top_decliners_abs: [],
  anomalies: [],
  sector_snapshot: [],
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
      anomalies: parsed.anomalies ?? [],
      sector_snapshot: parsed.sector_snapshot ?? [],
    };
  } catch {
    return EMPTY_SIGNALS;
  }
}

async function loadDigestSnippet(): Promise<string> {
  const digestPath = path.join(process.cwd(), "public", "rootfetch", "latest.md");
  try {
    const raw = await fs.readFile(digestPath, "utf-8");
    return raw
      .split("\n")
      .slice(0, 16)
      .join("\n")
      .trim();
  } catch {
    return "Latest digest is unavailable. Run `rootfetch run-daily` first.";
  }
}

function MoverList({ title, items }: { title: string; items: Mover[] }) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No rows for this window.</p>
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

export default async function Home() {
  const [latest, digestSnippet] = await Promise.all([loadLatestSignals(), loadDigestSnippet()]);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>RootFetch Daily Dashboard</p>
        <h1>Delegation trend signals from CZDS aggregate outputs</h1>
        <p className={styles.subtitle}>
          Live from committed artifacts only. No secrets, no raw zones, no direct CZDS calls.
        </p>

        <div className={styles.metaGrid}>
          <article>
            <p>Latest date (UTC)</p>
            <strong>{latest.date_utc}</strong>
          </article>
          <article>
            <p>Approved TLDs</p>
            <strong>{fmtInt(latest.approved_tlds_count)}</strong>
          </article>
          <article>
            <p>Run ID</p>
            <strong className={styles.mono}>{latest.run_id}</strong>
          </article>
        </div>

        <div className={styles.links}>
          <Link href="/rootfetch/latest.md">Read digest</Link>
          <Link href="/api/latest">JSON API</Link>
          <Link href="/about">About metrics</Link>
        </div>
      </section>

      <section className={styles.grid3}>
        <MoverList title="Top movers (abs)" items={latest.top_movers_abs} />
        <MoverList title="Top movers (pct)" items={latest.top_movers_pct} />
        <MoverList title="Top decliners" items={latest.top_decliners_abs} />
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
