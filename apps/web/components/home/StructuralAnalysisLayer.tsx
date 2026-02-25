"use client";

import { useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

import {
  DelegationRadarChartClient as DelegationRadarChart,
  MarketTreemapClient as MarketTreemap,
  PowerCurveChartClient as PowerCurveChart,
} from "@/components/home/HomeClientCharts";

type ReplayWindow = "now" | "d7" | "d30" | "d90";

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

function replayCount(row: MarketMapRow, window: ReplayWindow): number {
  const nowCount = Math.max(0, num(row.count));
  if (window === "now") return nowCount;
  if (window === "d7") {
    const abs = row.delta_7d_abs;
    if (Number.isFinite(Number(abs))) return Math.max(0, nowCount - num(abs));
    const pct = row.delta_7d_pct;
    if (Number.isFinite(Number(pct))) return Math.max(0, nowCount / (1 + num(pct)));
    return nowCount;
  }
  if (window === "d30") {
    const abs = row.delta_30d_abs;
    if (Number.isFinite(Number(abs))) return Math.max(0, nowCount - num(abs));
    const pct = row.delta_30d_pct;
    if (Number.isFinite(Number(pct))) return Math.max(0, nowCount / (1 + num(pct)));
    return nowCount;
  }
  const abs30 = row.delta_30d_abs;
  if (Number.isFinite(Number(abs30))) return Math.max(0, nowCount - num(abs30) * 3);
  const pct30 = row.delta_30d_pct;
  if (Number.isFinite(Number(pct30))) return Math.max(0, nowCount / (1 + num(pct30) * 3));
  return nowCount;
}

function replayDeltaAbs(row: MarketMapRow, window: ReplayWindow): number {
  if (window === "d7") return num(row.delta_7d_abs, num(row.delta_abs));
  if (window === "d30") return num(row.delta_30d_abs, num(row.delta_abs));
  if (window === "d90") return num(row.delta_30d_abs, num(row.delta_abs)) * 3;
  return num(row.delta_abs);
}

function replayDeltaPct(row: MarketMapRow, window: ReplayWindow): number {
  if (window === "d7") return num(row.delta_7d_pct, num(row.delta_pct));
  if (window === "d30") return num(row.delta_30d_pct, num(row.delta_pct));
  if (window === "d90") return num(row.delta_30d_pct, num(row.delta_pct)) * 3;
  return num(row.delta_pct);
}

function radarGrowth(row: RadarPoint, window: ReplayWindow): number {
  if (window === "d7") return num(row.growth_7d_pct, num(row.growth_pct) * 0.55);
  if (window === "d30") return num(row.growth_30d_pct, num(row.growth_pct) * 0.35);
  if (window === "d90") return num(row.growth_30d_pct, num(row.growth_pct) * 0.35) * 0.75;
  return num(row.growth_pct);
}

const REPLAY_OPTIONS: Array<{ key: ReplayWindow; label: string; subtitle: string }> = [
  { key: "now", label: "Now", subtitle: "Live snapshot" },
  { key: "d7", label: "-7d", subtitle: "Weekly rewind" },
  { key: "d30", label: "-30d", subtitle: "Monthly rewind" },
  { key: "d90", label: "-90d", subtitle: "Quarter rewind" },
];

export default function StructuralAnalysisLayer({
  marketMapRows,
  powerCurve,
  radarRows,
}: {
  marketMapRows: MarketMapRow[];
  powerCurve: PowerCurvePayload;
  radarRows: RadarPoint[];
}) {
  const [window, setWindow] = useState<ReplayWindow>("now");

  const replayedMarketRows = useMemo(() => {
    const rows = marketMapRows.map((row) => ({
      ...row,
      count: replayCount(row, window),
      delta_abs: replayDeltaAbs(row, window),
      delta_pct: replayDeltaPct(row, window),
    }));
    const total = rows.reduce((sum, row) => sum + num(row.count), 0);
    return rows.map((row) => ({
      ...row,
      share_pct: total > 0 ? (num(row.count) / total) * 100 : 0,
    }));
  }, [marketMapRows, window]);

  const replayedRadarRows = useMemo(
    () =>
      radarRows.map((row) => ({
        ...row,
        growth_pct: radarGrowth(row, window),
      })),
    [radarRows, window],
  );

  const powerFocus = window === "d90" ? "d90" : window === "d30" ? "d30" : "today";

  return (
    <>
      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Structural analysis engine</p>
            <h2 className="font-display text-2xl font-semibold">Treemap intelligence surface</h2>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/35 p-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Replay timeline</p>
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
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {REPLAY_OPTIONS.find((item) => item.key === window)?.subtitle}
            </p>
          </div>
        </div>
        <MarketTreemap rows={replayedMarketRows} />
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Power curve</p>
          <h2 className="font-display text-2xl font-semibold">Concentration morph</h2>
        </div>
        <PowerCurveChart curve={powerCurve} forcedFocus={powerFocus} />
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Delegation radar</p>
          <h2 className="font-display text-2xl font-semibold">Growth x volatility strategic map</h2>
        </div>
        <DelegationRadarChart rows={replayedRadarRows} windowLabel={window} />
      </section>
    </>
  );
}
