"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import MetricPill from "@/components/MetricPill";

export type RunsArchiveRow = {
  run_id: string;
  snapshot_ts_utc: string;
  snapshot_utc_day: string;
  model_version: string;
  regime: string;
  regime_confidence: number;
  dvi_score: number;
  dvi_band: "stable" | "elevated" | "active" | "turbulent";
};

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function toneForRegime(regime: string): "success" | "warning" | "danger" | "default" {
  const normalized = regime.toUpperCase();
  if (normalized === "STABLE") return "success";
  if (normalized === "ELEVATED" || normalized === "CONSOLIDATING" || normalized === "FRAGMENTING") return "warning";
  if (normalized === "ACTIVE" || normalized === "TURBULENT") return "danger";
  return "default";
}

function stripTone(regime: string): string {
  const normalized = regime.toUpperCase();
  if (normalized === "STABLE") return "bg-emerald-400/70";
  if (normalized === "ELEVATED" || normalized === "CONSOLIDATING" || normalized === "FRAGMENTING")
    return "bg-amber-400/70";
  if (normalized === "ACTIVE") return "bg-orange-400/70";
  if (normalized === "TURBULENT") return "bg-rose-400/70";
  return "bg-slate-400/60";
}

export default function RunsArchiveClient({
  rows,
}: {
  rows: RunsArchiveRow[];
}) {
  const [regimeFilter, setRegimeFilter] = useState<string>("all");
  const [bandFilter, setBandFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [leftRunId, setLeftRunId] = useState<string>(rows[0]?.run_id || "");
  const [rightRunId, setRightRunId] = useState<string>(rows[1]?.run_id || rows[0]?.run_id || "");

  const availableRegimes = useMemo(() => {
    const values = Array.from(new Set(rows.map((row) => row.regime).filter(Boolean)));
    return values.sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (regimeFilter !== "all" && row.regime !== regimeFilter) return false;
      if (bandFilter !== "all" && row.dvi_band !== bandFilter) return false;
      if (startDate && row.snapshot_utc_day < startDate) return false;
      if (endDate && row.snapshot_utc_day > endDate) return false;
      return true;
    });
  }, [rows, regimeFilter, bandFilter, startDate, endDate]);

  const timelineRows = filteredRows.length > 0 ? [...filteredRows].reverse() : [];

  return (
    <section className="rf-glass rounded-2xl border border-border/60 p-5">
      {rows.length > 0 ? (
        <div className="mb-4 grid gap-3 rounded-xl border border-border/70 bg-background/45 p-3 md:grid-cols-[1fr,1fr,auto] md:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Left run
            <select
              value={leftRunId}
              onChange={(event) => setLeftRunId(event.target.value)}
              className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
            >
              {rows.map((row) => (
                <option key={`left-${row.run_id}`} value={row.run_id}>
                  {row.snapshot_ts_utc} • {row.run_id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Right run
            <select
              value={rightRunId}
              onChange={(event) => setRightRunId(event.target.value)}
              className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
            >
              {rows.map((row) => (
                <option key={`right-${row.run_id}`} value={row.run_id}>
                  {row.snapshot_ts_utc} • {row.run_id}
                </option>
              ))}
            </select>
          </label>
          <Link
            href={`/compare?left=${encodeURIComponent(leftRunId)}&right=${encodeURIComponent(rightRunId)}`}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border/70 px-3 text-sm hover:border-primary/50"
          >
            Compare selected runs
          </Link>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          Regime
          <select
            value={regimeFilter}
            onChange={(event) => setRegimeFilter(event.target.value)}
            className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
          >
            <option value="all">All</option>
            {availableRegimes.map((regime) => (
              <option key={regime} value={regime}>
                {regime}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          DVI band
          <select
            value={bandFilter}
            onChange={(event) => setBandFilter(event.target.value)}
            className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
          >
            <option value="all">All</option>
            <option value="stable">Stable</option>
            <option value="elevated">Elevated</option>
            <option value="active">Active</option>
            <option value="turbulent">Turbulent</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          Start date
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          End date
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="min-w-0 w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="rounded-xl border border-border/70 bg-background/50 p-3">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.14em] text-muted-foreground">
          <span>Regime timeline</span>
          <span>{filteredRows.length} runs</span>
        </div>
        {timelineRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs match the selected filters.</p>
        ) : (
          <div className="flex h-6 items-end gap-1">
            {timelineRows.map((row) => (
              <span
                key={row.run_id}
                title={`${row.snapshot_utc_day} • ${row.regime} • DVI ${row.dvi_score.toFixed(1)}`}
                className={`h-full min-w-[6px] flex-1 rounded-sm ${stripTone(row.regime)}`}
              />
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <MetricPill tone="safe">Stable</MetricPill>
          <MetricPill tone="rolling">Elevated</MetricPill>
          <MetricPill tone="baseline">Active</MetricPill>
          <Badge tone="danger">Turbulent</Badge>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No runs in this filter window"
          description="Adjust regime/DVI/date filters to browse immutable run history."
        />
      ) : (
        <div className="mt-4 max-w-full overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-2 py-2">Snapshot UTC</th>
                <th className="px-2 py-2">Run ID</th>
                <th className="px-2 py-2">DVI</th>
                <th className="px-2 py-2">Regime</th>
                <th className="px-2 py-2">Confidence</th>
                <th className="px-2 py-2">Model version</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.run_id} className="border-b border-border/50">
                  <td className="px-2 py-2 rf-mono-digits">{row.snapshot_ts_utc}</td>
                  <td className="px-2 py-2 rf-mono-digits">
                    <Link href={`/runs/${encodeURIComponent(row.run_id)}`} className="text-cyan-200 hover:text-cyan-100">
                      {row.run_id}
                    </Link>
                  </td>
                  <td className="px-2 py-2 rf-mono-digits">{row.dvi_score.toFixed(1)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={toneForRegime(row.regime)}>{row.regime}</Badge>
                  </td>
                  <td className="px-2 py-2 rf-mono-digits">{fmtPct(row.regime_confidence)}</td>
                  <td className="px-2 py-2 rf-mono-digits">{row.model_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
