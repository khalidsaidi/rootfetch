"use client";

import { useEffect, useMemo, useState } from "react";

import Callout from "@/components/Callout";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import CompareTldChart from "@/components/charts/CompareTldChart";
import { track } from "@/lib/analytics/ga";

type SeriesRow = {
  date_utc: string;
  tld: string;
  count: number;
};

type PivotRow = {
  date_utc: string;
  [key: string]: string | number;
};

type TopTld = {
  tld: string;
  count: number;
};

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] || "";
    });
    return row;
  });
}

function toPivotRows(rows: SeriesRow[], tlds: string[]): PivotRow[] {
  const byDate = new Map<string, PivotRow>();
  rows.forEach((row) => {
    if (!byDate.has(row.date_utc)) {
      byDate.set(row.date_utc, { date_utc: row.date_utc });
    }
    byDate.get(row.date_utc)![row.tld] = row.count;
  });
  return [...byDate.values()].sort((a, b) => String(a.date_utc).localeCompare(String(b.date_utc))).map((row) => {
    const normalized = { ...row };
    tlds.forEach((tld) => {
      if (!(tld in normalized)) {
        normalized[tld] = 0;
      }
    });
    return normalized;
  });
}

export default function CompareClient() {
  const [inputTld, setInputTld] = useState("");
  const [selected, setSelected] = useState<string[]>(["xyz", "app", "dev"]);
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [topTlds, setTopTlds] = useState<TopTld[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/rootfetch/top_tlds_latest.csv", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("top_tlds unavailable");
        }
        return response.text();
      })
      .then((raw) => {
        const parsed = parseCsv(raw).map((row) => ({
          tld: row.tld || "",
          count: Number(row.count || 0),
        }));
        setTopTlds(parsed.filter((item) => item.tld));
      })
      .catch(() => {
        setTopTlds([]);
      });
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      return;
    }
    let mounted = true;
    const query = selected.join(",");
    fetch(`/api/tld-series?tlds=${encodeURIComponent(query)}&days=${days}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          track("rf_api_error", { route: "/api/tld-series", status: response.status });
          throw new Error(`API ${response.status}`);
        }
        return response.json() as Promise<{ rows: SeriesRow[] }>;
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
          setError("Could not load comparison series.");
        }
      });

    return () => {
      mounted = false;
    };
  }, [selected, days]);

  const pivotRows = useMemo(() => (selected.length === 0 ? [] : toPivotRows(rows, selected)), [rows, selected]);
  const suggestions = useMemo(() => topTlds.slice(0, 15).map((item) => item.tld), [topTlds]);

  const addTld = (tld: string) => {
    const normalized = tld.trim().toLowerCase();
    if (!normalized || selected.includes(normalized) || selected.length >= 3) {
      return;
    }
    setSelected((prev) => [...prev, normalized]);
    track("rf_tld_compare_add", { tld: normalized });
  };

  const removeTld = (tld: string) => {
    setSelected((prev) => prev.filter((item) => item !== tld));
    track("rf_tld_compare_remove", { tld });
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Compare TLDs" subtitle="Select up to three TLDs and compare delegated counts over time.">
        <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            type="text"
            value={inputTld}
            onChange={(event) => setInputTld(event.target.value)}
            placeholder="Add a TLD (e.g. xyz)"
            className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
          />
          <button
            type="button"
            className="h-10 rounded-lg border border-border/70 px-3 text-xs hover:border-primary/40"
            onClick={() => {
              addTld(inputTld);
              setInputTld("");
            }}
          >
            Add TLD
          </button>
          <TrackedLink href="/" label="back_home_compare" pageType="compare" className="inline-flex h-10 items-center justify-center rounded-lg border border-border/70 px-3 text-xs hover:border-primary/40">
            Dashboard
          </TrackedLink>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {[30, 90, 180].map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md border px-3 py-1.5 text-xs ${days === value ? "border-primary/50 bg-primary/10" : "border-border/70"}`}
              onClick={() => {
                setDays(value);
                track("rf_chart_range_change", { chart: "compare_tlds", range_days: value });
              }}
            >
              {value}d
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {selected.map((tld) => (
            <span key={tld} className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs">
              {tld}
              <button type="button" onClick={() => removeTld(tld)}>
                ✕
              </button>
            </span>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {suggestions.map((tld) => (
            <button
              key={tld}
              type="button"
              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:border-primary/40"
              onClick={() => addTld(tld)}
            >
              {tld}
            </button>
          ))}
        </div>

        {error ? <Callout variant="warning">{error}</Callout> : null}

        {selected.length === 0 ? (
          <Callout>Select at least one TLD to render the chart.</Callout>
        ) : (
          <CompareTldChart rows={pivotRows} tlds={selected} />
        )}
      </Section>

      <Section title="Export">
        <button
          type="button"
          className="rounded-md border border-border/70 px-3 py-1.5 text-xs hover:border-primary/40"
          onClick={async () => {
            const csv = [
              ["date_utc", ...selected].join(","),
              ...pivotRows.map((row) => [
                row.date_utc,
                ...selected.map((tld) => String(row[tld] || 0)),
              ].join(",")),
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "rootfetch_compare.csv";
            anchor.click();
            URL.revokeObjectURL(url);
            track("rf_download_csv", { kind: "tld_timeseries" });
          }}
        >
          Download comparison CSV
        </button>
      </Section>
    </main>
  );
}
