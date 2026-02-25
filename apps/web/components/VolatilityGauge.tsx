"use client";

import { track } from "@/lib/analytics/ga";

type DviPayload = {
  score?: number;
  level?: string;
  dispersion_component?: number;
  anomaly_component?: number;
  top10_shift_component?: number;
};

export default function VolatilityGauge({ dvi }: { dvi: DviPayload }) {
  const score = Math.max(0, Math.min(100, Number(dvi.score || 0)));
  const level = (dvi.level || "stable").toLowerCase();

  const labelClass =
    level === "high"
      ? "text-rose-300"
      : level === "elevated"
        ? "text-amber-300"
        : "text-cyan-300";

  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Delegation volatility index</p>
        <button
          type="button"
          className="rounded border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:border-primary/40"
          onClick={() => track("volatility_toggle", { score, level })}
        >
          details
        </button>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-display text-3xl font-semibold">{score.toFixed(1)}</p>
        <p className={`text-sm uppercase tracking-wide ${labelClass}`}>{level}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 via-amber-300 to-fuchsia-400 transition-all duration-500"
          style={{ width: `${Math.max(5, score)}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
        <p>disp {Number(dvi.dispersion_component || 0).toFixed(1)}</p>
        <p>anom {Number(dvi.anomaly_component || 0).toFixed(1)}</p>
        <p>top10 {Number(dvi.top10_shift_component || 0).toFixed(1)}</p>
      </div>
    </div>
  );
}
