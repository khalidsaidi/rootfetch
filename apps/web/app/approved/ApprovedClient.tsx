"use client";

import { useEffect, useMemo, useState } from "react";

import Badge from "@/components/Badge";
import Callout from "@/components/Callout";
import Section from "@/components/Section";
import StatCard from "@/components/StatCard";
import TrackedLink from "@/components/TrackedLink";
import { track } from "@/lib/analytics/ga";

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
  last_seen_by_tld?: Record<string, string>;
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
  last_seen_by_tld: {},
};

export default function ApprovedClient() {
  const [coverage, setCoverage] = useState<CoverageLatest>(EMPTY_COVERAGE);
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/rootfetch/coverage_latest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed coverage_latest.json ${response.status}`);
        }
        return response.json() as Promise<CoverageLatest>;
      })
      .then((payload) => {
        if (!mounted) {
          return;
        }
        setCoverage({
          ...EMPTY_COVERAGE,
          ...payload,
          approved_tlds: payload.approved_tlds || [],
          counted_today_tlds: payload.counted_today_tlds || [],
          counted_ever_tlds: payload.counted_ever_tlds || [],
          missing_ever_tlds: payload.missing_ever_tlds || [],
          last_seen_by_tld: payload.last_seen_by_tld || {},
        });
      })
      .catch(() => {
        if (mounted) {
          setCoverage(EMPTY_COVERAGE);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const countedTodaySet = useMemo(() => new Set(coverage.counted_today_tlds), [coverage.counted_today_tlds]);
  const countedEverSet = useMemo(() => new Set(coverage.counted_ever_tlds), [coverage.counted_ever_tlds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return coverage.approved_tlds;
    }
    return coverage.approved_tlds.filter((tld) => tld.includes(needle));
  }, [coverage.approved_tlds, query]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      track("rf_approved_search", {
        q_len: query.trim().length,
        matches_count: filtered.length,
      });
    }, 280);
    return () => window.clearTimeout(id);
  }, [query, filtered.length]);

  const rows = useMemo(
    () =>
      filtered.map((tld) => {
        if (countedTodaySet.has(tld)) {
          return {
            tld,
            status: "observed in snapshot",
            lastSeen: coverage.last_seen_by_tld?.[tld] || coverage.date_utc,
          };
        }
        if (countedEverSet.has(tld)) {
          return {
            tld,
            status: "observed previously",
            lastSeen: coverage.last_seen_by_tld?.[tld] || "",
          };
        }
        return { tld, status: "not yet observed", lastSeen: "" };
      }),
    [filtered, countedTodaySet, countedEverSet, coverage.last_seen_by_tld, coverage.date_utc]
  );

  const copyText = async (text: string, label: string, which: "approved" | "missing" | "counted", count: number) => {
    await navigator.clipboard.writeText(text);
    setCopyStatus(`${label} copied`);
    track("rf_copy_approved_list", { which, count });
    setTimeout(() => setCopyStatus(""), 1600);
  };

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "TLD Coverage Index",
    numberOfItems: filtered.length,
    itemListElement: filtered.slice(0, 50).map((tld, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: tld,
    })),
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-14 pt-8 md:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }} />

      <Section title="TLD Coverage Universe" subtitle="Every tracked TLD with observation status from immutable artifacts.">
        <div className="mb-4 flex flex-wrap gap-2">
          <TrackedLink href="/" label="back_home" pageType="coverage" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
            Dashboard
          </TrackedLink>
          <TrackedLink href="/rootfetch/coverage_latest.json" label="open_coverage_json" pageType="coverage" eventName="rf_open_json_api" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
            coverage_latest.json
          </TrackedLink>
          <TrackedLink href="/rootfetch/artifacts/latest.json" label="open_latest_pointer" pageType="coverage" eventName="rf_open_json_api" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
            latest.json
          </TrackedLink>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Universe tracked" value={coverage.approved_tlds_count} />
          <StatCard label="Observed at least once" value={coverage.counted_ever_count} />
          <StatCard label="Not yet observed" value={coverage.missing_ever_count} />
          <StatCard label="Observed in snapshot" value={coverage.counted_today_count} />
        </div>
      </Section>

      <Section title="Search + Actions">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
          <input
            type="search"
            value={query}
            data-testid="approved-search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tracked TLDs"
            className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
          />
          <button
            type="button"
            className="h-10 rounded-lg border border-border/70 px-3 text-xs hover:border-primary/40"
            onClick={() => copyText(coverage.approved_tlds.join(","), "Tracked universe list", "approved", coverage.approved_tlds.length)}
          >
            Copy tracked
          </button>
          <button
            type="button"
            className="h-10 rounded-lg border border-border/70 px-3 text-xs hover:border-primary/40"
            onClick={() => copyText(coverage.missing_ever_tlds.join(","), "Not yet observed list", "missing", coverage.missing_ever_tlds.length)}
          >
            Copy not-yet-observed
          </button>
          <button
            type="button"
            className="h-10 rounded-lg border border-border/70 px-3 text-xs hover:border-primary/40"
            onClick={() => copyText(coverage.counted_ever_tlds.join(","), "Observed list", "counted", coverage.counted_ever_tlds.length)}
          >
            Copy observed
          </button>
        </div>
        {copyStatus ? <p className="mt-2 text-xs text-primary">{copyStatus}</p> : null}
      </Section>

      <Section title="TLD List" subtitle={`Showing ${filtered.length.toLocaleString()} rows.`}>
        {rows.length === 0 ? (
          <Callout>No matching TLDs for the current query.</Callout>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2">TLD</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tld} className="border-b border-border/50">
                    <td className="py-2 font-semibold">{row.tld}</td>
                    <td className="py-2">
                      {row.status === "observed in snapshot" ? (
                        <Badge tone="success">observed in snapshot</Badge>
                      ) : row.status === "observed previously" ? (
                        <Badge tone="warning">observed previously</Badge>
                      ) : (<Badge tone="danger">not yet observed</Badge>)}
                    </td>
                    <td className="py-2 text-muted-foreground">{row.lastSeen || "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}
