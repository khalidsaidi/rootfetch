"use client";

import { useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

import TrackedLink from "./TrackedLink";

type TopRow = {
  tld: string;
  count: number;
  share_pct: number;
  sector: string;
  cadence?: string;
};

type SortKey = "count" | "share_pct" | "tld";

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export default function TopTldTableClient({ rows }: { rows: TopRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [sectorFilter, setSectorFilter] = useState<string>("all");

  const sectors = useMemo(() => {
    const unique = [...new Set(rows.map((row) => row.sector || "other"))].sort();
    return ["all", ...unique];
  }, [rows]);

  const filtered = useMemo(() => {
    const working = sectorFilter === "all" ? rows : rows.filter((row) => (row.sector || "other") === sectorFilter);
    const ordered = [...working].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (typeof left === "string" && typeof right === "string") {
        return left.localeCompare(right);
      }
      return Number(left) - Number(right);
    });
    return direction === "asc" ? ordered : ordered.reverse();
  }, [rows, sectorFilter, sortKey, direction]);

  const updateSort = (nextSort: SortKey) => {
    const nextDirection = sortKey === nextSort && direction === "desc" ? "asc" : "desc";
    setSortKey(nextSort);
    setDirection(nextDirection);
    track("rf_market_sort", {
      table: "top_tlds",
      key: nextSort,
      dir: nextDirection,
      sort_key: nextSort,
      direction: nextDirection,
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border/70 px-2.5 py-1 text-xs hover:border-primary/50"
          onClick={() => updateSort("count")}
        >
          Sort by count
        </button>
        <button
          type="button"
          className="rounded-md border border-border/70 px-2.5 py-1 text-xs hover:border-primary/50"
          onClick={() => updateSort("share_pct")}
        >
          Sort by share
        </button>
        <button
          type="button"
          className="rounded-md border border-border/70 px-2.5 py-1 text-xs hover:border-primary/50"
          onClick={() => updateSort("tld")}
        >
          Sort by name
        </button>
        <select
          className="rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs"
          value={sectorFilter}
          onChange={(event) => {
            const value = event.target.value;
            setSectorFilter(value);
            track("rf_market_filter", {
              filter_key: "sector",
              filter_value: value,
              value,
            });
          }}
        >
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sector === "all" ? "All sectors" : sector}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="pb-2">#</th>
              <th className="pb-2">TLD</th>
              <th className="pb-2">Count</th>
              <th className="pb-2">Share</th>
              <th className="pb-2">Sector</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 20).map((row, idx) => (
              <tr key={`${row.tld}-${idx}`} className="border-b border-border/50 last:border-b-0">
                <td className="py-2 text-muted-foreground">{idx + 1}</td>
                <td className="py-2 font-semibold">
                  <TrackedLink
                    href={`/tld/${row.tld}`}
                    label={`top_tld_${row.tld}`}
                    pageType="home"
                    eventName="rf_top_tld_row_click"
                    eventParams={{ tld: row.tld, rank: idx + 1, sector: row.sector || "other" }}
                    className="hover:text-primary"
                  >
                    {row.tld}
                  </TrackedLink>
                </td>
                <td className="py-2">{fmtInt(row.count)}</td>
                <td className="py-2">{fmtPct(row.share_pct)}</td>
                <td className="py-2 text-muted-foreground">{row.sector || "other"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
