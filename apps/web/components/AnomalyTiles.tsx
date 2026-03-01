"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import { track } from "@/lib/analytics/ga";

type AnomalyTile = {
  tld: string;
  count: number;
  delta_abs: number;
  delta_pct: number;
  anomaly_score?: number;
  robust_z?: number;
  z_score?: number;
  label?: string;
  intensity?: string;
  sector?: string;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtInt(value)}`;
}

function formatMaybeNumber(value: unknown): string {
  if (value == null || value === "") return "n/a";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "n/a";
}

function intensityClass(intensity?: string): string {
  if (intensity === "high") {
    return "border-fuchsia-400/70 bg-fuchsia-400/10";
  }
  if (intensity === "medium") {
    return "border-amber-300/70 bg-amber-300/10";
  }
  return "border-cyan-300/70 bg-cyan-300/10";
}

export default function AnomalyTiles({ rows }: { rows: AnomalyTile[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
        No anomaly spotlight rows yet. Signals appear after multiple observations.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.slice(0, 8).map((row, idx) => (
        <motion.div
          key={`${row.tld}-${idx}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: idx * 0.04 }}
          className={`rounded-2xl border p-3 ${intensityClass(row.intensity)}`}
        >
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/tld/${row.tld}`}
              className="font-display text-lg font-semibold hover:text-primary"
              onClick={() => {
                track("anomaly_open", { tld: row.tld, sector: row.sector || "other" });
                track("rf_core_mover_click", { tld: row.tld });
              }}
            >
              .{row.tld}
            </Link>
            <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] uppercase tracking-wide">
              {row.label || "signal"}
            </span>
          </div>
          <p className="mt-2 text-xl font-semibold">{fmtSigned(row.delta_abs)}</p>
          <p className="text-xs text-muted-foreground">{fmtPct(row.delta_pct)} day delta</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded border border-border/70 px-1.5 py-0.5">z {formatMaybeNumber(row.z_score)}</span>
            <span className="rounded border border-border/70 px-1.5 py-0.5">robust {formatMaybeNumber(row.robust_z)}</span>
            <span className="rounded border border-border/70 px-1.5 py-0.5">{fmtInt(row.count)} delegated</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
