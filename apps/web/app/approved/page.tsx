"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type CoverageLatest = {
  date_utc: string;
  approved_tlds_count: number;
  approved_tlds: string[];
  counted_today_tlds: string[];
  counted_today_count: number;
  counted_ever_tlds: string[];
  counted_ever_count: number;
  missing_ever_tlds: string[];
  missing_ever_count: number;
};

const EMPTY_COVERAGE: CoverageLatest = {
  date_utc: "n/a",
  approved_tlds_count: 0,
  approved_tlds: [],
  counted_today_tlds: [],
  counted_today_count: 0,
  counted_ever_tlds: [],
  counted_ever_count: 0,
  missing_ever_tlds: [],
  missing_ever_count: 0,
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function ApprovedPage() {
  const [coverage, setCoverage] = useState<CoverageLatest>(EMPTY_COVERAGE);
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState<string>("");

  useEffect(() => {
    let alive = true;
    fetch("/rootfetch/coverage_latest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load coverage_latest.json: ${response.status}`);
        }
        return response.json();
      })
      .then((payload: CoverageLatest) => {
        if (!alive) return;
        setCoverage({
          ...EMPTY_COVERAGE,
          ...payload,
          approved_tlds: payload.approved_tlds ?? [],
          counted_today_tlds: payload.counted_today_tlds ?? [],
          counted_ever_tlds: payload.counted_ever_tlds ?? [],
          missing_ever_tlds: payload.missing_ever_tlds ?? [],
        });
      })
      .catch(() => {
        if (!alive) return;
        setCoverage(EMPTY_COVERAGE);
      });
    return () => {
      alive = false;
    };
  }, []);

  const countedToday = useMemo(() => new Set(coverage.counted_today_tlds), [coverage.counted_today_tlds]);
  const countedEver = useMemo(() => new Set(coverage.counted_ever_tlds), [coverage.counted_ever_tlds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coverage.approved_tlds;
    return coverage.approved_tlds.filter((tld) => tld.includes(q));
  }, [coverage.approved_tlds, query]);

  const rows = useMemo(
    () =>
      filtered.map((tld) => {
        if (countedToday.has(tld)) {
          return { tld, status: "counted today" };
        }
        if (countedEver.has(tld)) {
          return { tld, status: "counted before" };
        }
        return { tld, status: "not counted yet" };
      }),
    [filtered, countedEver, countedToday]
  );

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopyStatus(`${label} copied`);
    window.setTimeout(() => setCopyStatus(""), 1800);
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Approved Coverage</p>
        <h1>All approved TLDs and ingestion coverage</h1>
        <p className={styles.subtitle}>Derived from committed artifacts only: approved_tlds, daily_counts, growth_trends.</p>
        <div className={styles.links}>
          <Link href="/">Back to dashboard</Link>
          <Link href="/rootfetch/coverage_latest.json">Raw coverage JSON</Link>
          <Link href="/rootfetch/approved_latest.json">Raw approved list</Link>
        </div>
      </header>

      <section className={styles.summaryGrid}>
        <article>
          <p>Approved TLDs</p>
          <strong>{fmtInt(coverage.approved_tlds_count)}</strong>
        </article>
        <article>
          <p>Counted ever</p>
          <strong>{fmtInt(coverage.counted_ever_count)}</strong>
        </article>
        <article>
          <p>Missing ever</p>
          <strong>{fmtInt(coverage.missing_ever_count)}</strong>
        </article>
        <article>
          <p>Counted today</p>
          <strong>{fmtInt(coverage.counted_today_count)}</strong>
        </article>
      </section>

      <section className={styles.controls}>
        <input
          type="search"
          placeholder="Search approved TLDs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={() => copyText(coverage.approved_tlds.join(","), "Approved list")}>Copy approved list</button>
        <button type="button" onClick={() => copyText(coverage.missing_ever_tlds.join(","), "Missing list")}>Copy missing list</button>
      </section>

      {copyStatus ? <p className={styles.copyStatus}>{copyStatus}</p> : null}

      <section className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>TLD</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tld}>
                <td>{row.tld}</td>
                <td>
                  <span
                    className={
                      row.status === "counted today"
                        ? styles.today
                        : row.status === "counted before"
                          ? styles.before
                          : styles.missing
                    }
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
