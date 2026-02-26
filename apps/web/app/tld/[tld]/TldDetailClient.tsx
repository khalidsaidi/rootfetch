"use client";

import { useEffect, useMemo, useState } from "react";

import Callout from "@/components/Callout";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import TldSeriesChart from "@/components/charts/TldSeriesChart";
import { track } from "@/lib/analytics/ga";

type TldSeriesRow = {
  date_utc: string;
  tld: string;
  count: number;
  delta_abs: number;
  delta_pct: number;
  cadence: string;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default function TldDetailClient({
  tld,
  sector,
  initialRows,
}: {
  tld: string;
  sector: string;
  initialRows: TldSeriesRow[];
}) {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<TldSeriesRow[]>(initialRows);
  const [error, setError] = useState("");
  const initialCadence = initialRows.at(-1)?.cadence || "";

  useEffect(() => {
    track("rf_tld_page_view", { tld, sector: sector || "other", cadence: initialCadence });
  }, [tld, sector, initialCadence]);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/tld-series?tld=${encodeURIComponent(tld)}&days=${days}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          track("rf_api_error", { route: "/api/tld-series", status: response.status });
          throw new Error(`API ${response.status}`);
        }
        return response.json() as Promise<{ rows: TldSeriesRow[] }>;
      })
      .then((payload) => {
        if (!mounted) {
          return;
        }
        setRows(payload.rows || []);
        setError("");
      })
      .catch(() => {
        if (mounted) {
          setError("Unable to load this TLD series.");
        }
      });

    return () => {
      mounted = false;
    };
  }, [tld, days]);

  const latest = useMemo(() => rows.at(-1), [rows]);
  const prev = useMemo(() => (rows.length > 1 ? rows.at(-2) : null), [rows]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title={`.${tld} Delegation Profile`} subtitle="SEO-friendly TLD detail page with trend and cadence context.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[30, 90, 180].map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md border px-3 py-1.5 text-xs ${days === value ? "border-primary/50 bg-primary/10" : "border-border/70"}`}
              onClick={() => {
                setDays(value);
                track("rf_chart_range_change", { chart: "tld_series", range_days: value });
              }}
            >
              {value}d
            </button>
          ))}
          <TrackedLink href="/compare/tlds" label="open_compare_from_tld" pageType="tld" className="ml-auto text-xs text-primary hover:text-primary/80">
            Compare TLDs
          </TrackedLink>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Latest count</p>
            <p className="mt-1 text-xl font-semibold">{latest ? fmtInt(latest.count) : "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Previous count</p>
            <p className="mt-1 text-xl font-semibold">{prev ? fmtInt(prev.count) : "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Daily delta</p>
            <p className="mt-1 text-xl font-semibold">{latest ? fmtInt(latest.delta_abs) : "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Delta %</p>
            <p className="mt-1 text-xl font-semibold">{latest ? fmtPct(latest.delta_pct || 0) : "n/a"}</p>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">Sector: {sector || "other"} • cadence: {latest?.cadence || "n/a"}</p>

        {error ? <Callout variant="warning">{error}</Callout> : null}
        {rows.length > 0 ? <TldSeriesChart rows={rows} /> : <Callout>No observed data for this TLD yet.</Callout>}
      </Section>

      <Section title="Export">
        <button
          type="button"
          className="rounded-md border border-border/70 px-3 py-1.5 text-xs hover:border-primary/40"
          onClick={async () => {
            const csv = [
              "date_utc,count,delta_abs,delta_pct,cadence",
              ...rows.map((row) => [row.date_utc, row.count, row.delta_abs, row.delta_pct, row.cadence].join(",")),
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `rootfetch_${tld}_timeseries.csv`;
            anchor.click();
            URL.revokeObjectURL(url);
            track("rf_download_csv", { kind: "tld_timeseries" });
          }}
        >
          Download TLD time series CSV
        </button>
      </Section>
    </main>
  );
}
