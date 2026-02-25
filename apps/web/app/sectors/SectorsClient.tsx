"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Callout from "@/components/Callout";
import DownloadLinkButton from "@/components/DownloadLinkButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import SectorSeriesChart from "@/components/charts/SectorSeriesChart";
import { track } from "@/lib/analytics/ga";

type SectorRow = {
  date_utc: string;
  sector: string;
  sector_count: number;
  sector_delta_pct: number;
};

type SectorChartRow = {
  date_utc: string;
  [key: string]: string | number;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function SectorsClient() {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [error, setError] = useState("");
  const [activeSectors, setActiveSectors] = useState<string[]>([]);
  const initializedSectors = useRef(false);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/sector-series?days=${days}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          track("rf_api_error", { route: "/api/sector-series", status: response.status });
          throw new Error(`API ${response.status}`);
        }
        return response.json() as Promise<{ rows: SectorRow[] }>;
      })
      .then((payload) => {
        if (!mounted) {
          return;
        }
        const data = payload.rows || [];
        setRows(data);
        setError("");
        if (!initializedSectors.current) {
          const latestBySector = new Map<string, number>();
          data.forEach((row) => {
            latestBySector.set(row.sector, row.sector_count);
          });
          const top = [...latestBySector.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map((item) => item[0]);
          setActiveSectors(top);
          initializedSectors.current = true;
        }
      })
      .catch(() => {
        if (mounted) {
          setError("Could not load sector indices.");
        }
      });

    return () => {
      mounted = false;
    };
  }, [days]);

  const allSectors = useMemo(() => [...new Set(rows.map((row) => row.sector))].sort(), [rows]);

  const chartRows = useMemo(() => {
    const byDate = new Map<string, SectorChartRow>();
    rows.forEach((row) => {
      if (!byDate.has(row.date_utc)) {
        byDate.set(row.date_utc, { date_utc: row.date_utc });
      }
      byDate.get(row.date_utc)![row.sector] = row.sector_count;
    });
    return [...byDate.values()].sort((a, b) => String(a.date_utc).localeCompare(String(b.date_utc)));
  }, [rows]);

  const latestRows = useMemo(() => {
    if (rows.length === 0) {
      return [];
    }
    const latestDate = [...rows].sort((a, b) => a.date_utc.localeCompare(b.date_utc)).at(-1)?.date_utc;
    return rows
      .filter((row) => row.date_utc === latestDate)
      .sort((a, b) => b.sector_count - a.sector_count);
  }, [rows]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Sector Indices" subtitle="Time-series of delegated counts grouped by RootFetch sector map.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[30, 90, 180].map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md border px-3 py-1.5 text-xs ${days === value ? "border-primary/50 bg-primary/10" : "border-border/70"}`}
              onClick={() => {
                setDays(value);
                track("rf_chart_range_change", { chart: "sector_indices", range_days: value });
              }}
            >
              {value}d
            </button>
          ))}
          <TrackedLink href="/" label="back_home_sectors" pageType="sectors" className="ml-auto text-xs text-primary hover:text-primary/80">
            Back to dashboard
          </TrackedLink>
          <DownloadLinkButton
            href="/rootfetch/sector_indices.csv"
            filename="rootfetch_sector_indices.csv"
            label="Download CSV"
            kind="sector_indices"
          />
        </div>

        {error ? <Callout variant="warning">{error}</Callout> : null}

        {chartRows.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {allSectors.map((sector) => {
                const selected = activeSectors.includes(sector);
                return (
                  <button
                    key={sector}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-primary/50 bg-primary/10" : "border-border/70"}`}
                    onClick={() => {
                      setActiveSectors((prev) => {
                        const exists = prev.includes(sector);
                        const next = exists ? prev.filter((item) => item !== sector) : [...prev, sector];
                        track("rf_chart_series_toggle", { chart: "sector_indices", series: sector });
                        return next;
                      });
                    }}
                  >
                    {sector}
                  </button>
                );
              })}
            </div>

            <SectorSeriesChart rows={chartRows} sectors={activeSectors.length > 0 ? activeSectors : allSectors.slice(0, 5)} />
          </>
        ) : (
          <Callout>Sector index history is not available yet.</Callout>
        )}
      </Section>

      <Section title="Latest Sector Snapshot">
        {latestRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2">Sector</th>
                  <th className="pb-2">Count</th>
                  <th className="pb-2">Delta %</th>
                </tr>
              </thead>
              <tbody>
                {latestRows.map((row) => (
                  <tr key={row.sector} className="border-b border-border/50">
                    <td className="py-2 font-medium">{row.sector}</td>
                    <td className="py-2">{fmtInt(row.sector_count)}</td>
                    <td className="py-2">{Number.isFinite(row.sector_delta_pct) ? `${(row.sector_delta_pct * 100).toFixed(2)}%` : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Callout>No sector snapshot available.</Callout>
        )}
      </Section>
    </main>
  );
}
