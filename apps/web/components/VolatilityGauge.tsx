"use client";

import { useMemo } from "react";

import { track } from "@/lib/analytics/ga";

type DviPayload = {
  score?: number;
  level?: string;
  dispersion_component?: number;
  anomaly_component?: number;
  top10_shift_component?: number;
};

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const coords = points
    .map((point, idx) => `${(idx / Math.max(1, points.length - 1)) * 100},${100 - ((point - min) / range) * 100}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="h-10 w-full">
      <polyline points={coords} fill="none" stroke="#00d4ff" strokeWidth="2.5" />
    </svg>
  );
}

export default function VolatilityGauge({ dvi, trendSeries }: { dvi: DviPayload; trendSeries?: number[] }) {
  const score = Math.max(0, Math.min(100, Number(dvi.score ?? 0)));
  const level = useMemo(() => {
    if (score >= 75) return "turbulent";
    if (score >= 50) return "active";
    if (score >= 25) return "elevated";
    return "stable";
  }, [score]);
  const angle = -120 + (score / 100) * 240;
  const labelClass = level === "turbulent"
    ? "text-rose-300"
    : level === "active"
      ? "text-orange-300"
      : level === "elevated"
        ? "text-amber-300"
        : "text-emerald-300";
  const disp = Number(dvi.dispersion_component || 0) / 100;
  const shift = Number(dvi.top10_shift_component || 0) / 100;
  const cluster = Number(dvi.anomaly_component || 0) / 100;
  const spark = (trendSeries && trendSeries.length > 1 ? trendSeries : [score * 0.86, score * 0.9, score * 0.94, score * 0.98, score]).slice(-30);

  return (
    <div className="rf-glass rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
        <p>Delegation Volatility Index</p>
        <button
          type="button"
          className="rounded border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:border-primary/40"
          onClick={() => track("volatility_toggle", { score, level, page_type: "home" })}
        >
          drivers
        </button>
      </div>

      <div className="relative mt-2 flex items-center justify-center">
        <div className="pointer-events-none absolute h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div
          className="relative h-52 w-52 rounded-full"
          style={{
            background:
              "conic-gradient(from 210deg, #00ff85 0deg, #00ff85 60deg, #ffb800 120deg, #ff8a00 180deg, #ff4d4d 240deg, rgba(35,42,52,0.7) 240deg)",
          }}
        >
          <div className="absolute inset-[10px] rounded-full bg-[#0f141b] shadow-[inset_0_0_0_1px_rgba(95,115,140,0.28)]" />
          <div className="absolute left-1/2 top-1/2 h-[70px] w-[2px] -translate-x-1/2 -translate-y-[90%] origin-bottom rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.35)] transition-transform duration-700 ease-[cubic-bezier(.4,0,.2,1)]" style={{ transform: `translate(-50%, -90%) rotate(${angle}deg)` }} />
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/70 bg-cyan-300/60 shadow-[0_0_12px_rgba(0,212,255,0.4)]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="rf-mono-digits text-4xl font-semibold">{score.toFixed(1)}</p>
            <p className={`mt-0.5 text-[11px] uppercase tracking-[0.18em] ${labelClass}`}>{level}</p>
          </div>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <div className="mb-1 grid grid-cols-4 gap-1">
          <span>0-25 Stable</span>
          <span>25-50 Elevated</span>
          <span>50-75 Active</span>
          <span>75-100 Turbulent</span>
        </div>
        <p className="mb-1 text-[9px] tracking-[0.14em] text-muted-foreground/90">30d volatility history</p>
        <Sparkline points={spark} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <p className="rounded-md border border-border/60 bg-background/40 px-2 py-1">
          Dispersion <span className="rf-mono-digits text-muted-foreground">{disp.toFixed(2)}</span>
        </p>
        <p className="rounded-md border border-border/60 bg-background/40 px-2 py-1">
          Top-10 shift <span className="rf-mono-digits text-muted-foreground">{shift.toFixed(2)}</span>
        </p>
        <p className="rounded-md border border-border/60 bg-background/40 px-2 py-1">
          Anomaly cluster <span className="rf-mono-digits text-muted-foreground">{cluster.toFixed(2)}</span>
        </p>
      </div>
    </div>
  );
}
