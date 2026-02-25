"use client";

import { ShieldAlert } from "lucide-react";

type MarketRisk = {
  concentration_risk?: string;
  concentration_score?: number;
  top10_share_pct?: number;
  top3_share_pct?: number;
  hhi?: number;
  fragmentation?: string;
  tiny_tld_saturation_trend?: string;
  core_dominance?: string;
};

function fmtPct(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function marketState(risk: MarketRisk): "stable" | "fragmenting" | "consolidating" | "speculative" {
  const top10 = Number(risk.top10_share_pct || 0);
  const concentration = Number(risk.concentration_score || 0);
  if (concentration >= 75 || top10 >= 72) {
    return "consolidating";
  }
  if (concentration >= 55 || top10 >= 62) {
    return "speculative";
  }
  if ((risk.fragmentation || "").toLowerCase() === "high") {
    return "fragmenting";
  }
  return "stable";
}

function stateTone(state: string): string {
  if (state === "consolidating") return "text-rose-300";
  if (state === "speculative") return "text-orange-300";
  if (state === "fragmenting") return "text-amber-300";
  return "text-emerald-300";
}

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const coords = points
    .map((point, idx) => `${(idx / (points.length - 1)) * 100},${100 - ((point - min) / range) * 100}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="h-10 w-full">
      <polyline points={coords} fill="none" stroke="#00d4ff" strokeWidth="2.5" />
    </svg>
  );
}

export default function MarketRiskPanel({ risk }: { risk: MarketRisk }) {
  const score = Math.max(0, Math.min(100, Number(risk.concentration_score || 0)));
  const state = marketState(risk);
  const spark = [
    score * 0.82,
    score * 0.9,
    score * 0.94,
    score * 0.98,
    score,
  ];
  return (
    <div className="rf-glass rounded-2xl p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Risk state</p>
      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">Market state</p>
      <p className={`mt-1 font-display text-3xl font-semibold uppercase ${stateTone(state)}`}>
        {state}
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-2 py-1.5">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <p className="text-xs text-muted-foreground">Concentration score {score.toFixed(1)}</p>
      </div>

      <div className="mt-2 rounded-lg border border-border/70 bg-background/30 px-2 py-1">
        <Sparkline points={spark} />
      </div>

      <div className="mt-3 grid gap-1.5 text-sm">
        <p className="flex items-center justify-between rounded-md border border-border/60 bg-background/35 px-2 py-1">
          <span className="text-muted-foreground">Top 10 share</span>
          <span className="rf-mono-digits">{fmtPct(risk.top10_share_pct)}</span>
        </p>
        <p className="flex items-center justify-between rounded-md border border-border/60 bg-background/35 px-2 py-1">
          <span className="text-muted-foreground">HHI</span>
          <span className="rf-mono-digits">{typeof risk.hhi === "number" ? risk.hhi.toFixed(4) : "n/a"}</span>
        </p>
        <p className="flex items-center justify-between rounded-md border border-border/60 bg-background/35 px-2 py-1">
          <span className="text-muted-foreground">Fragmentation score</span>
          <span className="rf-mono-digits">{risk.fragmentation || "n/a"}</span>
        </p>
      </div>
    </div>
  );
}
