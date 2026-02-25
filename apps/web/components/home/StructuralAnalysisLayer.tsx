"use client";

import { useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

import {
  DelegationRadarChartClient as DelegationRadarChart,
  MarketTreemapClient as MarketTreemap,
  PowerCurveChartClient as PowerCurveChart,
} from "@/components/home/HomeClientCharts";
import { useReplayTimeline } from "@/components/home/ReplayTimelineContext";

type ReplayWindow = "now" | "d7" | "d30" | "d90" | "custom";

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
  cadence?: string;
};

type RadarPoint = {
  tld: string;
  growth_pct: number;
  growth_7d_pct?: number;
  growth_30d_pct?: number;
  volatility?: number;
  anomaly_score?: number;
  count: number;
  sector?: string;
};

type CurvePoint = { rank: number; tld: string; count: number };
type PowerCurvePayload = {
  today?: CurvePoint[];
  d30?: CurvePoint[];
  d90?: CurvePoint[];
  date_utc_today?: string;
  date_utc_d30?: string;
  date_utc_d90?: string;
};

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    const abs = row.delta_7d_abs;
    if (Number.isFinite(Number(abs))) return Math.max(0, nowCount - num(abs) * (horizonDays / 7));
    const pct = row.delta_7d_pct;
    if (Number.isFinite(Number(pct))) return Math.max(0, safeDiv(nowCount, 1 + num(pct) * (horizonDays / 7), nowCount));
    return nowCount;
  }

  const scale30 = horizonDays / 30;
  const abs30 = row.delta_30d_abs;
  if (Number.isFinite(Number(abs30))) return Math.max(0, nowCount - num(abs30) * scale30);
  const pct30 = row.delta_30d_pct;
  if (Number.isFinite(Number(pct30))) return Math.max(0, safeDiv(nowCount, 1 + num(pct30) * scale30, nowCount));
  if (Number.isFinite(Number(row.delta_abs))) return Math.max(0, nowCount - num(row.delta_abs) * Math.min(7, horizonDays));
  return nowCount;
}

function radarGrowth(row: RadarPoint, horizonDays: number): number {
  if (horizonDays <= 0) return num(row.growth_pct);
  if (horizonDays <= 7) return num(row.growth_7d_pct, num(row.growth_pct) * 0.6) * (horizonDays / 7);
  if (horizonDays <= 30) return num(row.growth_30d_pct, num(row.growth_pct) * 0.4) * (horizonDays / 30);
  return num(row.growth_30d_pct, num(row.growth_pct) * 0.35) * (horizonDays / 30);
}

function horizonForWindow(window: ReplayWindow, customDays: number): number {
  if (window === "now") return 0;
  if (window === "d7") return 7;
  if (window === "d30") return 30;
  if (window === "d90") return 90;
  return customDays;
}

function replaySubtitle(window: ReplayWindow, customDays: number): string {
  if (window === "now") return "Live snapshot";
  if (window === "d7") return "Weekly rewind";
  if (window === "d30") return "Monthly rewind";
  if (window === "d90") return "Quarter rewind";
  return `Custom replay (${customDays}d back)`;
}

function ymdForOffset(baseDateUtc: string | undefined, daysBack: number): string {
  const base = parseDate(baseDateUtc) || new Date();
  const shifted = new Date(base.getTime() - clamp(daysBack, 0, 365) * 86_400_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stateTone(state: string): string {
  if (state === "consolidating") return "text-rose-300";
  if (state === "speculative") return "text-orange-300";
  if (state === "fragmenting") return "text-amber-300";
  return "text-emerald-300";
}

function dviBand(score: number): string {
  if (score >= 75) return "Turbulent";
  if (score >= 50) return "Active";
  if (score >= 25) return "Elevated";
  return "Stable";
}

const REPLAY_OPTIONS: Array<{ key: ReplayWindow; label: string }> = [
  { key: "now", label: "Now" },
  { key: "d7", label: "-7d" },
  { key: "d30", label: "-30d" },
  { key: "d90", label: "-90d" },
  { key: "custom", label: "Custom date" },
];

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function fmtNum(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export default function StructuralAnalysisLayer({
  marketMapRows,
  powerCurve,
  radarRows,
}: {
  marketMapRows: MarketMapRow[];
  powerCurve: PowerCurvePayload;
  radarRows: RadarPoint[];
}) {
  const { replayDays, isControlled } = useReplayTimeline();
  const [window, setWindow] = useState<ReplayWindow>("now");
  const [customDate, setCustomDate] = useState<string>(powerCurve.date_utc_today || "");

  const customDays = useMemo(() => {
    const latest = parseDate(powerCurve.date_utc_today);
    const chosen = parseDate(customDate);
    if (!latest || !chosen) return 30;
    const diffDays = Math.floor((latest.getTime() - chosen.getTime()) / 86_400_000);
    return clamp(diffDays, 0, 365);
  }, [customDate, powerCurve.date_utc_today]);

  const activeHorizonDays = isControlled
    ? replayDays
    : window === "custom"
      ? customDays
      : horizonForWindow(window, customDays);

  const replayedMarketRows = useMemo(() => {
    const rows = marketMapRows
      .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
      .map((row) => {
      const replayedCount = replayCount(row, activeHorizonDays);
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
    return rows.map((row) => ({
      ...row,
      share_pct: total > 0 ? (num(row.count) / total) * 100 : 0,
    }));
  }, [marketMapRows, activeHorizonDays]);

  const replayedRadarRows = useMemo(
    () =>
      radarRows
        .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
        .map((row) => ({
          ...row,
          growth_pct: radarGrowth(row, activeHorizonDays),
          volatility: num(row.volatility),
          anomaly_score: num(row.anomaly_score),
          count: Math.max(0, num(row.count)),
        })),
    [radarRows, activeHorizonDays],
  );

  const replayStats = useMemo(() => {
    const sorted = [...replayedMarketRows].sort((a, b) => num(b.count) - num(a.count));
    const total = sorted.reduce((sum, row) => sum + num(row.count), 0);
    const top10Share = total > 0 ? (sorted.slice(0, 10).reduce((sum, row) => sum + num(row.count), 0) / total) * 100 : 0;
    const hhi = total > 0 ? sorted.reduce((sum, row) => sum + Math.pow(num(row.count) / total, 2), 0) : 0;
    const deltaValues = replayedMarketRows.map((row) => num(row.delta_pct));
    const mean = deltaValues.length ? deltaValues.reduce((sum, item) => sum + item, 0) / deltaValues.length : 0;
    const variance = deltaValues.length
      ? deltaValues.reduce((sum, item) => sum + Math.pow(item - mean, 2), 0) / deltaValues.length
      : 0;
    const dispersion = Math.sqrt(variance);
    const anomalyAvg = replayedMarketRows.length
      ? replayedMarketRows.reduce((sum, row) => sum + num(row.anomaly_score), 0) / replayedMarketRows.length
      : 0;
    const dviScore = clamp(dispersion * 900 + anomalyAvg * 10 + top10Share * 0.4, 0, 100);
    const state = structuralState(top10Share, dviScore);
    return { total, top10Share, hhi, dviScore, state, anomalyAvg };
  }, [replayedMarketRows]);

  const powerFocus = activeHorizonDays <= 20 ? "today" : activeHorizonDays <= 75 ? "d30" : "d90";

  return (
    <>
      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3 grid gap-3 xl:grid-cols-[1.3fr,0.7fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Structural analysis engine</p>
            <h2 className="font-display text-2xl font-semibold">Treemap intelligence surface</h2>
            {!isControlled ? (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REPLAY_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`rounded-md border px-2.5 py-1 text-xs transition ${
                        window === option.key
                          ? "border-primary/60 bg-primary/15 text-foreground"
                          : "border-border/70 bg-background/45 text-muted-foreground hover:border-primary/30"
                      }`}
                      onClick={() => {
                        setWindow(option.key);
                        track("volatility_toggle", { chart: "structural_replay", range_days: option.key });
                        track("rf_chart_range_change", { chart: "structural_replay", range_days: option.key });
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                  {window === "custom" ? (
                    <input
                      type="date"
                      value={customDate}
                      max={powerCurve.date_utc_today || undefined}
                      className="rounded-md border border-border/70 bg-background/50 px-2 py-1 text-xs"
                      onChange={(event) => {
                        setCustomDate(event.target.value);
                        setWindow("custom");
                      }}
                    />
                  ) : null}
                </div>
                <div className="mt-2 rounded-xl border border-border/70 bg-background/35 p-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Replay timeline scrubber</span>
                    <span className="rf-mono-digits">{activeHorizonDays}d</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={365}
                    step={1}
                    value={activeHorizonDays}
                    className="w-full accent-cyan-400"
                    onChange={(event) => {
                      const nextDays = clamp(Number(event.target.value), 0, 365);
                      setWindow("custom");
                      setCustomDate(ymdForOffset(powerCurve.date_utc_today, nextDays));
                      track("volatility_toggle", { chart: "structural_replay_scrubber", range_days: nextDays });
                      track("rf_chart_range_change", { chart: "structural_replay_scrubber", range_days: nextDays });
                    }}
                  />
                  <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Now</span>
                    <span>-7d</span>
                    <span>-30d</span>
                    <span>-90d</span>
                    <span>Custom</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-2 rounded-xl border border-border/70 bg-background/25 p-2 text-xs text-muted-foreground">
                Global structural timeline is active: <span className="rf-mono-digits">{activeHorizonDays}d rewind</span>.
              </div>
            )}
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {isControlled ? `Global replay (${activeHorizonDays}d back)` : replaySubtitle(window, activeHorizonDays)}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/35 p-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Replay model output</p>
            <p className={`mt-1 font-display text-2xl font-semibold uppercase ${stateTone(replayStats.state)}`}>
              {replayStats.state}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
              <p>DVI <span className="rf-mono-digits">{replayStats.dviScore.toFixed(1)}</span> ({dviBand(replayStats.dviScore)})</p>
              <p>Top10 <span className="rf-mono-digits">{fmtPct(replayStats.top10Share)}</span></p>
              <p>HHI <span className="rf-mono-digits">{replayStats.hhi.toFixed(4)}</span></p>
              <p>Total <span className="rf-mono-digits">{fmtNum(replayStats.total)}</span></p>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <MarketTreemap rows={replayedMarketRows} />
        </div>
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Power curve</p>
          <h2 className="font-display text-2xl font-semibold">Concentration morph</h2>
        </div>
        <div className="min-w-0">
          <PowerCurveChart curve={powerCurve} forcedFocus={powerFocus} />
        </div>
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Delegation radar</p>
          <h2 className="font-display text-2xl font-semibold">Growth x volatility strategic map</h2>
        </div>
        <div className="min-w-0">
          <DelegationRadarChart rows={replayedRadarRows} windowLabel={isControlled ? `${activeHorizonDays}d` : window === "custom" ? `${activeHorizonDays}d` : window} />
        </div>
      </section>
    </>
  );
}
