"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

type AnomalyRow = {
  tld: string;
  delta_abs: number;
  delta_pct: number;
  robust_z?: number;
  z_score?: number;
  anomaly_score?: number;
  volatility?: number;
  count?: number;
  sector?: string;
  label?: string;
};

type Severity = "critical" | "high" | "moderate" | "info";

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

function toFiniteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function zValue(row: AnomalyRow): number | null {
  const robust = toFiniteOrNull(row.robust_z);
  if (robust != null) return robust;
  const z = toFiniteOrNull(row.z_score);
  if (z != null) return z;
  return null;
}

function anomalyValue(row: AnomalyRow): number | null {
  return toFiniteOrNull(row.anomaly_score);
}

function rankMagnitude(row: AnomalyRow): number {
  const z = zValue(row);
  if (z != null) return Math.abs(z);
  const score = anomalyValue(row);
  return score == null ? 0 : Math.abs(score);
}

function intensityClass(row: AnomalyRow): string {
  const severity = severityOf(row);
  if (severity === "critical") {
    return "border-red-500/70 bg-red-500/15 text-red-100";
  }
  if (severity === "high") {
    return "border-rose-500/60 bg-rose-500/10 text-rose-100";
  }
  if (severity === "moderate") {
    return "border-amber-300/60 bg-amber-300/10 text-amber-100";
  }
  return "border-cyan-400/50 bg-cyan-400/10 text-cyan-100";
}

function severityOf(row: AnomalyRow): Severity {
  const zRaw = zValue(row);
  const z = zRaw == null ? null : Math.abs(zRaw);
  const absDeltaPct = Math.abs(Number(row.delta_pct || 0));
  if ((z != null && z >= 4) || absDeltaPct >= 0.06) return "critical";
  if ((z != null && z >= 3.5) || absDeltaPct >= 0.03) return "high";
  if ((z != null && z >= 2) || absDeltaPct >= 0.01) return "moderate";
  return "info";
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
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [tldFilter, setTldFilter] = useState<string>("");
  const [replay24h, setReplay24h] = useState(false);

  const sectors = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((row) => (row.sector || "other").toLowerCase()))).sort()],
    [rows],
  );

  const feed = useMemo(() => {
    if (!rows.length) return [];
    const normalizedQuery = tldFilter.trim().toLowerCase();
    const filtered = rows
      .filter((row) => severityFilter === "all" || severityOf(row) === severityFilter)
      .filter((row) => sectorFilter === "all" || (row.sector || "other").toLowerCase() === sectorFilter)
      .filter((row) => !normalizedQuery || row.tld.toLowerCase().includes(normalizedQuery));
    const sorted = replay24h
      ? [...filtered].sort((a, b) => rankMagnitude(b) - rankMagnitude(a))
      : filtered;
    return [...sorted.slice(0, 16), ...sorted.slice(0, 16)];
  }, [rows, replay24h, sectorFilter, severityFilter, tldFilter]);

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
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {(["all", "critical", "high", "moderate", "info"] as const).map((item) => (
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
          <select
            value={sectorFilter}
            className="rounded border border-border/70 bg-background/45 px-2 py-0.5 uppercase tracking-[0.12em] text-muted-foreground"
            onChange={(event) => {
              setSectorFilter(event.target.value);
              track("rf_market_filter", { filter_key: "anomaly_sector", value: event.target.value });
            }}
          >
            {sectors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            value={tldFilter}
            placeholder="tld"
            className="w-[84px] rounded border border-border/70 bg-background/45 px-2 py-0.5 uppercase tracking-[0.12em] text-muted-foreground placeholder:text-muted-foreground/70"
            onChange={(event) => setTldFilter(event.target.value)}
          />
          <button
            type="button"
            className={`rounded border px-2 py-0.5 uppercase tracking-[0.12em] ${
              replay24h
                ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                : "border-border/70 bg-background/45 text-muted-foreground"
            }`}
            onClick={() => setReplay24h((prev) => !prev)}
          >
            {replay24h ? "replay 24h on" : "replay 24h"}
          </button>
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
        {feed.length > 0 ? (
          <div className="rf-marquee-track gap-2 p-2" style={{ animationPlayState: paused ? "paused" : "running" }}>
            {feed.map((row, idx) => {
              const z = zValue(row);
              const anomaly = anomalyValue(row);
              return (
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
                  <span>{z == null ? "z=n/a" : `z=${z.toFixed(2)}`}</span>{" "}
                  {z == null && anomaly != null ? <span>a={anomaly.toFixed(2)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">No anomaly events match current filters.</div>
        )}
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
            <p>z <span className="rf-mono-digits">{zValue(active)?.toFixed(2) ?? "n/a"}</span></p>
            <p>anomaly <span className="rf-mono-digits">{anomalyValue(active)?.toFixed(2) ?? "n/a"}</span></p>
            <p>vol30 <span className="rf-mono-digits">{Number(active.volatility || 0).toFixed(4)}</span></p>
            <p>count <span className="rf-mono-digits">{fmtInt(Number(active.count || 0))}</span></p>
            <p>sector <span>{active.sector || "other"}</span></p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
