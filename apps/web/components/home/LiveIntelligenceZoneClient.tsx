"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Waves } from "lucide-react";

import AnomalyTicker from "@/components/AnomalyTicker";
import MarketRiskPanel from "@/components/MarketRiskPanel";
import ThemeToggle from "@/components/ThemeToggle";
import TrackedLink from "@/components/TrackedLink";
import VolatilityGauge from "@/components/VolatilityGauge";
import { track } from "@/lib/analytics/ga";
import { PulseSeriesChartClient as PulseSeriesChart } from "@/components/home/HomeClientCharts";
import { useReplayTimeline } from "@/components/home/ReplayTimelineContext";

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

type MarketMapRow = {
  tld: string;
  count: number;
  share_pct: number;
  delta_abs: number;
  delta_pct: number;
  delta_7d_abs?: number;
  delta_30d_abs?: number;
  delta_7d_pct?: number;
  delta_30d_pct?: number;
  anomaly_score?: number;
  sector?: string;
};

type DviPayload = {
  score?: number;
  level?: string;
  dispersion_component?: number;
  anomaly_component?: number;
  top10_shift_component?: number;
};

type MarketRiskPayload = {
  concentration_risk?: string;
  concentration_score?: number;
  top10_share_pct?: number;
  top3_share_pct?: number;
  hhi?: number;
  fragmentation?: string;
  tiny_tld_saturation_trend?: string;
  core_dominance?: string;
};

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  const out = numerator / denominator;
  return Number.isFinite(out) ? out : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function structuralState(top10SharePct: number, dviScore: number): "stable" | "fragmenting" | "consolidating" | "speculative" {
  if (top10SharePct >= 70 || dviScore >= 72) return "consolidating";
  if (dviScore >= 50) return "speculative";
  if (top10SharePct <= 52) return "fragmenting";
  return "stable";
}

function replayCount(row: MarketMapRow, horizonDays: number): number {
  const nowCount = Math.max(0, num(row.count));
  if (horizonDays <= 0) return nowCount;

  if (horizonDays <= 7) {
    if (Number.isFinite(Number(row.delta_7d_abs))) {
      return Math.max(0, nowCount - num(row.delta_7d_abs) * (horizonDays / 7));
    }
    if (Number.isFinite(Number(row.delta_7d_pct))) {
      return Math.max(0, safeDiv(nowCount, 1 + num(row.delta_7d_pct) * (horizonDays / 7), nowCount));
    }
    return nowCount;
  }

  const scale30 = horizonDays / 30;
  if (Number.isFinite(Number(row.delta_30d_abs))) {
    return Math.max(0, nowCount - num(row.delta_30d_abs) * scale30);
  }
  if (Number.isFinite(Number(row.delta_30d_pct))) {
    return Math.max(0, safeDiv(nowCount, 1 + num(row.delta_30d_pct) * scale30, nowCount));
  }
  return Math.max(0, nowCount - num(row.delta_abs) * Math.min(7, horizonDays));
}

function fmtInt(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtSigned(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtInt(value)}`;
}

function fmtPct(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function stateTone(state: string): string {
  if (state === "consolidating") return "text-rose-300";
  if (state === "speculative") return "text-orange-300";
  if (state === "fragmenting") return "text-amber-300";
  return "text-emerald-300";
}

function pulseStatus({
  isZeroState,
  observedToday,
  approved,
}: {
  isZeroState: boolean;
  observedToday: number;
  approved: number;
}): { label: string; tone: string; detail: string } {
  if (isZeroState) {
    return { label: "BASELINE ESTABLISHING", tone: "text-cyan-200", detail: "Awaiting first committed snapshot" };
  }
  if (observedToday < approved) {
    return { label: "ROLLING HISTORY BUILDING", tone: "text-amber-200", detail: "Core + rolling observations are active" };
  }
  return { label: "LIVE SNAPSHOT ACTIVE", tone: "text-emerald-200", detail: "Full snapshot observations complete" };
}

function timestampForIndex(idx: number): string {
  const totalSeconds = (2 * 3600 + 14 * 60 + 22 - idx * 73 + 24 * 3600) % (24 * 3600);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function severityOf(row: AnomalyRow): "critical" | "high" | "moderate" | "info" {
  const z = Math.abs(num(row.robust_z ?? row.z_score));
  const delta = Math.abs(num(row.delta_pct));
  if (z >= 4 || delta >= 0.06) return "critical";
  if (z >= 3.2 || delta >= 0.03) return "high";
  if (z >= 2 || delta >= 0.01) return "moderate";
  return "info";
}

function dateForReplay(baseDateUtc: string, replayDays: number): string {
  const base = new Date(`${baseDateUtc}T00:00:00Z`);
  const shifted = new Date(base.getTime() - clamp(replayDays, 0, 365) * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export default function LiveIntelligenceZoneClient({
  dateUtc,
  approved,
  observedToday,
  totalDelegated,
  deltaTodayAbs,
  delta7dAbs,
  delta7dPct,
  pulseSeries,
  dvi,
  top10SharePct,
  marketRisk,
  distributionP50,
  approvalsAddedCount,
  approvalsAddedPreview,
  anomalyRows,
  marketMapRows,
}: {
  dateUtc: string;
  approved: number;
  observedToday: number;
  totalDelegated: number;
  deltaTodayAbs: number;
  delta7dAbs: number;
  delta7dPct: number;
  pulseSeries: Array<{ date_utc: string; total_delegated_count: number }>;
  dvi: DviPayload;
  top10SharePct: number;
  marketRisk: MarketRiskPayload;
  distributionP50: number;
  approvalsAddedCount: number;
  approvalsAddedPreview: string[];
  anomalyRows: AnomalyRow[];
  marketMapRows: MarketMapRow[];
}) {
  const { replayDays, setReplayDays } = useReplayTimeline();
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleSeverity, setConsoleSeverity] = useState<"all" | "critical" | "high" | "moderate" | "info">("all");
  const [consoleTldFilter, setConsoleTldFilter] = useState("");
  const [consoleCleared, setConsoleCleared] = useState(false);
  const [timelinePulseActive, setTimelinePulseActive] = useState(false);
  const timelinePulseTimerRef = useRef<number | null>(null);

  const triggerTimelinePulse = () => {
    setTimelinePulseActive(false);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => setTimelinePulseActive(true));
      if (timelinePulseTimerRef.current !== null) window.clearTimeout(timelinePulseTimerRef.current);
      timelinePulseTimerRef.current = window.setTimeout(() => setTimelinePulseActive(false), 420);
    }
  };

  useEffect(
    () => () => {
      if (timelinePulseTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(timelinePulseTimerRef.current);
      }
    },
    [],
  );

  const dviTrendSeries = useMemo(
    () =>
      pulseSeries
        .map((row, idx) => {
          const current = Number(row.total_delegated_count || 0);
          const prev = idx > 0 ? Number(pulseSeries[idx - 1]?.total_delegated_count || 0) : current;
          if (!Number.isFinite(current) || !Number.isFinite(prev) || prev <= 0) return 0;
          return Math.abs(((current - prev) / prev) * 100) * 10;
        })
        .filter((value) => Number.isFinite(value)),
    [pulseSeries],
  );

  const replayStats = useMemo(() => {
    const rows = marketMapRows.map((row) => {
      const replayedCount = replayCount(row, replayDays);
      const deltaAbs = num(row.count) - replayedCount;
      const deltaPct = safeDiv(deltaAbs, replayedCount, 0);
      return {
        ...row,
        count: replayedCount,
        delta_abs: deltaAbs,
        delta_pct: deltaPct,
      };
    });
    const total = rows.reduce((sum, row) => sum + num(row.count), 0);
    const sorted = [...rows].sort((a, b) => num(b.count) - num(a.count));
    const top10Share = total > 0 ? (sorted.slice(0, 10).reduce((sum, row) => sum + num(row.count), 0) / total) * 100 : 0;
    const hhi = total > 0 ? sorted.reduce((sum, row) => sum + Math.pow(num(row.count) / total, 2), 0) : 0;
    const deltaValues = rows.map((row) => num(row.delta_pct));
    const mean = deltaValues.length ? deltaValues.reduce((sum, item) => sum + item, 0) / deltaValues.length : 0;
    const variance =
      deltaValues.length > 0
        ? deltaValues.reduce((sum, item) => sum + Math.pow(item - mean, 2), 0) / deltaValues.length
        : 0;
    const dispersion = Math.sqrt(variance);
    const anomalyAvg = rows.length > 0 ? rows.reduce((sum, row) => sum + num(row.anomaly_score), 0) / rows.length : 0;
    const dviScore = clamp(dispersion * 900 + anomalyAvg * 10 + top10Share * 0.4, 0, 100);
    return { total, top10Share, hhi, dviScore };
  }, [marketMapRows, replayDays]);

  const shownTotalDelegated = replayDays > 0 ? replayStats.total : totalDelegated;
  const shownTop10Share = replayDays > 0 ? replayStats.top10Share : top10SharePct;
  const shownDviScore = replayDays > 0 ? replayStats.dviScore : num(dvi.score);
  const shownState = structuralState(shownTop10Share, shownDviScore);

  const marketRiskShown = useMemo(
    () => ({
      ...marketRisk,
      top10_share_pct: shownTop10Share,
      hhi: replayDays > 0 ? replayStats.hhi : marketRisk.hhi,
      concentration_risk: shownTop10Share >= 68 ? "high" : shownTop10Share >= 55 ? "moderate" : "low",
    }),
    [marketRisk, replayDays, replayStats.hhi, shownTop10Share],
  );

  const status = pulseStatus({ isZeroState: shownTotalDelegated <= 0, observedToday, approved });

  const pseudoDviSeries = useMemo(() => {
    if (pulseSeries.length === 0) return [shownDviScore];
    return pulseSeries.map((row, idx) => {
      const current = Number(row.total_delegated_count || 0);
      const prev = idx > 0 ? Number(pulseSeries[idx - 1]?.total_delegated_count || 0) : current;
      const pct = prev > 0 ? Math.abs((current - prev) / prev) : 0;
      return clamp(pct * 850 + shownTop10Share * 0.35, 0, 100);
    });
  }, [pulseSeries, shownDviScore, shownTop10Share]);

  const regimeTimeline = useMemo(
    () =>
      pseudoDviSeries.map((score) => ({
        score,
        state: structuralState(shownTop10Share, score),
      })),
    [pseudoDviSeries, shownTop10Share],
  );

  const regimeDurationDays = useMemo(() => {
    if (regimeTimeline.length === 0) return 1;
    const target = shownState;
    let count = 0;
    for (let idx = regimeTimeline.length - 1; idx >= 0; idx -= 1) {
      if (regimeTimeline[idx].state !== target) break;
      count += 1;
    }
    return Math.max(1, count);
  }, [regimeTimeline, shownState]);

  const regimeConfidence = useMemo(() => {
    const distances = [Math.abs(shownDviScore - 25), Math.abs(shownDviScore - 50), Math.abs(shownDviScore - 72)];
    const minDist = Math.min(...distances);
    return clamp(0.58 + minDist / 60 + regimeDurationDays / 120, 0.55, 0.99);
  }, [shownDviScore, regimeDurationDays]);

  const replayDateLabel = useMemo(
    () => (replayDays > 0 ? dateForReplay(dateUtc, replayDays) : dateUtc),
    [dateUtc, replayDays],
  );

  const structuralBrief = useMemo(() => {
    const topAnomalies = anomalyRows
      .slice(0, 2)
      .map((row) => `.${row.tld} ${row.delta_abs > 0 ? "+" : ""}${Math.round(row.delta_abs)}`)
      .join(", ");
    return `Namespace in ${shownState.toUpperCase()} regime. Top10 share ${shownTop10Share.toFixed(
      2,
    )}%. DVI ${shownDviScore.toFixed(1)}. ${
      topAnomalies ? `Primary signals: ${topAnomalies}.` : "Signals are within expected bounds."
    }`;
  }, [anomalyRows, shownDviScore, shownState, shownTop10Share]);

  const eventConsoleRows = useMemo(
    () =>
      anomalyRows.slice(0, 28).map((row, idx) => ({
        ...row,
        severity: severityOf(row),
        ts: timestampForIndex(idx),
      })),
    [anomalyRows],
  );

  const filteredConsoleRows = useMemo(() => {
    if (consoleCleared) return [];
    const query = consoleTldFilter.trim().toLowerCase();
    return eventConsoleRows.filter((row) => {
      if (consoleSeverity !== "all" && row.severity !== consoleSeverity) return false;
      if (query && !row.tld.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [consoleCleared, consoleSeverity, consoleTldFilter, eventConsoleRows]);

  return (
    <>
      <section className={`rf-glass overflow-hidden rounded-3xl p-5 md:p-6 ${timelinePulseActive ? "rf-timeline-pulse" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Delegation Intelligence Terminal</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              LIVE INTELLIGENCE ZONE
            </h1>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <TrackedLink href="/approved" label="nav_approved" pageType="home" eventName="rf_open_approved" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Approved TLDs
          </TrackedLink>
          <TrackedLink href="/sectors" label="nav_sectors" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Sector indices
          </TrackedLink>
          <TrackedLink href="/compare" label="nav_compare" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Compare
          </TrackedLink>
          <TrackedLink href="/recipes" label="nav_recipes" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Agent recipes
          </TrackedLink>
          <TrackedLink href="/api/latest" label="nav_json" pageType="home" eventName="rf_open_json_api" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Artifact API
          </TrackedLink>
        </div>

        <div className="mt-4 grid gap-5 border-t border-border/60 pt-4 xl:grid-cols-[1fr,1.2fr,0.85fr] xl:divide-x xl:divide-border/50">
          <div className="xl:pr-5">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <Waves className="h-3.5 w-3.5 text-primary" /> Delegation pulse
            </p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[11px]">
              <span className={`h-2 w-2 animate-pulse rounded-full ${status.tone === "text-emerald-200" ? "bg-emerald-300" : status.tone === "text-amber-200" ? "bg-amber-300" : "bg-cyan-300"}`} />
              <span className={`uppercase tracking-[0.14em] ${status.tone}`}>{status.label}</span>
            </div>
            <p className="rf-mono-digits mt-2 text-5xl font-semibold md:text-6xl">{fmtInt(shownTotalDelegated)}</p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <p className={deltaTodayAbs >= 0 ? "rf-signal-growth" : "rf-signal-down"}>{fmtSigned(deltaTodayAbs)} today</p>
              <p className={delta7dAbs >= 0 ? "rf-signal-growth" : "rf-signal-down"}>
                {fmtSigned(delta7dAbs)} 7d avg ({fmtPct(delta7dPct)})
              </p>
            </div>
            <div className="mt-3">
              <PulseSeriesChart rows={pulseSeries} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{status.detail}</p>
          </div>

          <div className="xl:px-5">
            <div className="scale-[1.2] origin-top">
              <VolatilityGauge
                dvi={{
                  ...dvi,
                  score: shownDviScore,
                }}
                trendSeries={dviTrendSeries}
              />
            </div>
            <div className="mt-4">
              <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Structural regime history (30d)</p>
              <div className="flex gap-[2px] overflow-hidden rounded border border-border/60 bg-background/35 p-1">
                {regimeTimeline.slice(-30).map((item, idx) => {
                  const tone =
                    item.state === "consolidating"
                      ? "bg-rose-400/80"
                      : item.state === "speculative"
                        ? "bg-orange-400/80"
                        : item.state === "fragmenting"
                          ? "bg-amber-400/80"
                          : "bg-emerald-400/80";
                  return <span key={idx} className={`h-3 flex-1 rounded-[2px] ${tone}`} title={`${item.state} ${item.score.toFixed(1)}`} />;
                })}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <span>Stable</span>
                <span>Elevated</span>
                <span>Consolidating</span>
                <span>Turbulent</span>
              </div>
            </div>
          </div>

          <div className="xl:pl-5 xl:pt-7">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Structural regime model</p>
            <div className="mt-2 rounded-lg border border-cyan-400/30 bg-cyan-500/8 p-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Derived from DVI</p>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                <p className="rounded border border-border/60 bg-background/35 px-2 py-1">
                  DVI <span className="rf-mono-digits text-foreground">{shownDviScore.toFixed(1)}</span>
                </p>
                <p className="rounded border border-border/60 bg-background/35 px-2 py-1">
                  Confidence <span className="rf-mono-digits text-foreground">{regimeConfidence.toFixed(2)}</span>
                </p>
              </div>
              <p className={`mt-2 font-display text-2xl font-semibold uppercase ${stateTone(shownState)}`}>Regime: {shownState}</p>
              <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <p>Duration: <span className="rf-mono-digits">{regimeDurationDays}</span> days</p>
                <p>Replay date: <span className="rf-mono-digits">{replayDateLabel}</span></p>
              </div>
            </div>
            <div className="mt-3">
              <MarketRiskPanel risk={marketRiskShown} />
            </div>
            <div className="mt-3 grid gap-2 text-xs">
              <p className="rounded-lg border border-border/70 bg-background/35 px-2 py-1.5">
                Median TLD size <span className="rf-mono-digits">{fmtInt(distributionP50)}</span>
              </p>
              <p className="rounded-lg border border-border/70 bg-background/35 px-2 py-1.5">
                New approvals {fmtInt(approvalsAddedCount)}
                {approvalsAddedPreview.length > 0 ? ` (${approvalsAddedPreview.slice(0, 3).join(", ")})` : ""}
              </p>
              <p className="rounded-lg border border-border/70 bg-primary/10 px-2 py-1.5 text-foreground">
                Structural brief: {structuralBrief}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border/70 bg-background/20 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">STRUCTURAL TIMELINE</p>
            <p className="rf-mono-digits text-xs text-muted-foreground">{replayDays}d rewind</p>
          </div>
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${replayDays === 0 ? "animate-pulse bg-emerald-300" : "bg-cyan-300"}`} />
              <span>{replayDays === 0 ? "Live" : `Replay ${replayDays}d`}</span>
            </div>
            <span className="rounded-full border border-emerald-300/45 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
              LIVE
            </span>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/85">
              LIVE
            </div>
            <input
              type="range"
              min={0}
              max={365}
              step={1}
              value={replayDays}
              className="rf-timeline-slider w-full pr-12"
              onChange={(event) => {
                const next = clamp(Number(event.target.value), 0, 365);
                setReplayDays(next);
                triggerTimelinePulse();
                track("volatility_toggle", { chart: "global_structural_timeline", range_days: next });
                track("rf_chart_range_change", { chart: "global_structural_timeline", range_days: next });
              }}
            />
          </div>
          <div className="mt-1 relative overflow-hidden rounded-full border border-border/60 bg-background/30">
            <div className="h-2 w-full bg-gradient-to-r from-emerald-400/55 via-amber-400/55 to-rose-400/60" />
          </div>
          <div className="mt-1 grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="text-emerald-300">Stable</span>
            <span className="text-center text-amber-200">Elevated</span>
            <span className="text-center text-orange-200">Consolidating</span>
            <span className="text-right text-rose-200">Turbulent</span>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="text-emerald-300">Now</span>
            <span className="text-center">-7d</span>
            <span className="text-center">-30d</span>
            <span className="text-right">-90d</span>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-2">
            {[0, 7, 30, 90].map((day) => (
              <span key={day} className="h-1 rounded-full bg-border/70" />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {[0, 7, 30, 90].map((day) => (
              <button
                key={day}
                type="button"
                className={`rounded-md border px-2 py-0.5 ${
                  replayDays === day
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border/70 bg-background/40 text-muted-foreground"
                }`}
                onClick={() => {
                  setReplayDays(day);
                  triggerTimelinePulse();
                }}
              >
                {day === 0 ? "Now" : `-${day}d`}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-border/60 pt-4">
          <AnomalyTicker rows={anomalyRows} />
        </div>
      </section>

      <aside
        className={`fixed right-2 top-24 z-40 hidden h-[70vh] w-[330px] flex-col rounded-2xl border border-border/70 bg-[#0c1118]/95 p-3 shadow-2xl backdrop-blur lg:flex ${
          consoleOpen ? "translate-x-0" : "translate-x-[296px]"
        } transition-transform duration-300`}
      >
        <button
          type="button"
          className="absolute -left-10 top-6 rounded-l-lg border border-border/70 bg-[#0c1118]/95 px-2 py-1 text-[11px] uppercase tracking-[0.12em]"
          onClick={() => setConsoleOpen((prev) => !prev)}
        >
          {consoleOpen ? "hide" : "events"}
        </button>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" /> Event console
        </div>
        <div className="mb-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5 text-[10px] uppercase tracking-[0.11em]">
            {(["all", "critical", "high", "moderate", "info"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded border px-1.5 py-0.5 ${
                  consoleSeverity === item
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border/70 bg-background/35 text-muted-foreground"
                }`}
                onClick={() => setConsoleSeverity(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={consoleTldFilter}
              onChange={(event) => setConsoleTldFilter(event.target.value)}
              placeholder="filter tld"
              className="flex-1 rounded border border-border/70 bg-background/35 px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              className="rounded border border-border/70 bg-background/35 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
              onClick={() => setConsoleCleared(true)}
            >
              Clear
            </button>
          </div>
          {consoleCleared ? (
            <button
              type="button"
              className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-foreground"
              onClick={() => setConsoleCleared(false)}
            >
              Restore log
            </button>
          ) : null}
        </div>
        <div className="space-y-1 overflow-auto pr-1 text-[11px]">
          {filteredConsoleRows.map((row, idx) => (
            <div key={`${row.tld}-${idx}`} className="rounded-md border border-border/60 bg-background/30 px-2 py-1">
              <span className="rf-mono-digits text-muted-foreground">[{row.ts}]</span>{" "}
              <span
                className={`font-semibold uppercase ${
                  row.severity === "critical"
                    ? "text-red-300"
                    : row.severity === "high"
                      ? "text-rose-300"
                      : row.severity === "moderate"
                        ? "text-amber-300"
                        : "text-cyan-300"
                }`}
              >
                {row.severity}
              </span>{" "}
              <span>.{row.tld}</span>{" "}
              <span className="rf-mono-digits">{fmtSigned(row.delta_abs)}</span>{" "}
              <span className="text-muted-foreground">{row.label || "signal"}</span>
            </div>
          ))}
          {filteredConsoleRows.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-background/30 px-2 py-1 text-muted-foreground">
              No events for current filters.
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
