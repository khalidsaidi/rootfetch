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

type Severity = "high" | "moderate" | "low";

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
    return "border-rose-500/60 bg-rose-500/10 text-rose-100";
  }
  if (z >= 2) {
    return "border-amber-300/60 bg-amber-300/10 text-amber-100";
  }
  return "border-cyan-400/50 bg-cyan-400/10 text-cyan-100";
}

function severityOf(row: AnomalyRow): Severity {
  const z = Number(row.robust_z || 0);
  if (z >= 3.5 || Math.abs(Number(row.delta_pct || 0)) >= 0.03) return "high";
  if (z >= 2 || Math.abs(Number(row.delta_pct || 0)) >= 0.01) return "moderate";
  return "low";
}

function timestampForIndex(idx: number): string {
  const totalMinutes = (2 * 60 + 14 - idx * 2 + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function AnomalyTicker({ rows }: { rows: AnomalyRow[] }) {
  const [active, setActive] = useState<AnomalyRow | null>(rows[0] || null);
  const [paused, setPaused] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

  const feed = useMemo(() => {
    if (!rows.length) return [];
    const filtered = rows.filter((row) => severityFilter === "all" || severityOf(row) === severityFilter);
    return [...filtered.slice(0, 16), ...filtered.slice(0, 16)];
  }, [rows, severityFilter]);

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
        SYSTEM STATUS: anomaly feed waiting for baseline deltas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Namespace event stream</p>
        <div className="flex gap-1.5 text-[11px]">
          {(["all", "high", "moderate", "low"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded border px-2 py-0.5 uppercase tracking-[0.12em] ${
                severityFilter === item
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border/70 bg-background/45 text-muted-foreground"
              }`}
              onClick={() => setSeverityFilter(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className={`rounded border px-2 py-0.5 uppercase tracking-[0.12em] ${
              paused ? "border-amber-300/60 bg-amber-300/10 text-amber-100" : "border-border/70 bg-background/45 text-muted-foreground"
            }`}
            onClick={() => setPaused((prev) => !prev)}
          >
            {paused ? "paused" : "live"}
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-black/45">
        <div className="rf-marquee-track gap-2 p-2" style={{ animationPlayState: paused ? "paused" : "running" }}>
          {feed.map((row, idx) => (
            <button
              type="button"
              key={`${row.tld}-${idx}`}
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-left text-xs tracking-wide ${intensityClass(row)}`}
              onClick={() => {
                setActive(row);
                track("anomaly_open", { tld: row.tld, sector: row.sector || "other" });
              }}
            >
              <span className="rf-mono-digits text-[10px] text-muted-foreground">[{timestampForIndex(idx)} UTC]</span>{" "}
              <span className="font-semibold uppercase">{severityOf(row)}</span>{" "}
              <span className="font-semibold">.{row.tld}</span>{" "}
              <span className="rf-mono-digits">{fmtSigned(row.delta_abs)}</span>{" "}
              <span>z={Number(row.robust_z || 0).toFixed(2)}</span>
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
