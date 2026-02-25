"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

type AnomalyRow = {
  tld: string;
  delta_abs: number;
  delta_pct: number;
  robust_z?: number;
  volatility?: number;
  count?: number;
  sector?: string;
  label?: string;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtInt(value)}`;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function intensityClass(row: AnomalyRow): string {
  const z = Number(row.robust_z || 0);
  if (z >= 3.5) {
    return "border-fuchsia-400/60 text-fuchsia-200";
  }
  if (z >= 2) {
    return "border-amber-300/60 text-amber-100";
  }
  return "border-cyan-400/50 text-cyan-100";
}

export default function AnomalyTicker({ rows }: { rows: AnomalyRow[] }) {
  const [active, setActive] = useState<AnomalyRow | null>(rows[0] || null);

  const feed = useMemo(() => {
    if (!rows.length) return [];
    return [...rows.slice(0, 14), ...rows.slice(0, 14)];
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
        SYSTEM STATUS: anomaly feed waiting for baseline deltas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-black/35">
        <div className="rf-marquee-track gap-2 p-2">
          {feed.map((row, idx) => (
            <button
              type="button"
              key={`${row.tld}-${idx}`}
              className={`whitespace-nowrap rounded-lg border bg-background/60 px-3 py-1.5 text-left text-xs tracking-wide ${intensityClass(row)}`}
              onClick={() => {
                setActive(row);
                track("anomaly_open", { tld: row.tld, sector: row.sector || "other" });
              }}
            >
              <span className="font-semibold">.{row.tld}</span>{" "}
              <span className="rf-mono-digits">{fmtSigned(row.delta_abs)}</span>{" "}
              <span>z={Number(row.robust_z || 0).toFixed(2)}</span>{" "}
              <span>{row.label || "signal"}</span>
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <div className="rf-glass rounded-xl p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-lg font-semibold">.{active.tld}</p>
            <Link
              href={`/tld/${active.tld}`}
              className="rounded-lg border border-border/70 px-2.5 py-1 text-xs hover:border-primary/50"
              onClick={() => track("rf_top_tld_row_click", { tld: active.tld, rank: 0, sector: active.sector || "other" })}
            >
              open detail
            </Link>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
            <p>delta <span className="rf-mono-digits">{fmtSigned(active.delta_abs)}</span></p>
            <p>delta% <span className="rf-mono-digits">{fmtPct(active.delta_pct)}</span></p>
            <p>robust z <span className="rf-mono-digits">{Number(active.robust_z || 0).toFixed(2)}</span></p>
            <p>vol30 <span className="rf-mono-digits">{Number(active.volatility || 0).toFixed(4)}</span></p>
            <p>count <span className="rf-mono-digits">{fmtInt(Number(active.count || 0))}</span></p>
            <p>sector <span>{active.sector || "other"}</span></p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
