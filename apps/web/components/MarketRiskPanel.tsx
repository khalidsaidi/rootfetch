"use client";

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

function riskTone(risk?: string): string {
  if (risk === "high") {
    return "text-rose-300";
  }
  if (risk === "moderate") {
    return "text-amber-300";
  }
  return "text-cyan-300";
}

function fmtPct(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

export default function MarketRiskPanel({ risk }: { risk: MarketRisk }) {
  const score = Number(risk.concentration_score || 0);
  return (
    <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Market risk panel</p>
      <p className={`mt-2 font-display text-2xl font-semibold ${riskTone(risk.concentration_risk)}`}>
        {(risk.concentration_risk || "stable").toUpperCase()}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/60">
        <div className="h-full bg-gradient-to-r from-cyan-400 via-amber-300 to-rose-400" style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">Top 10 share</span>
          <span>{fmtPct(risk.top10_share_pct)}</span>
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">Top 3 share</span>
          <span>{fmtPct(risk.top3_share_pct)}</span>
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">HHI</span>
          <span>{typeof risk.hhi === "number" ? risk.hhi.toFixed(4) : "n/a"}</span>
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">Fragmentation</span>
          <span>{risk.fragmentation || "n/a"}</span>
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">Tiny TLD saturation</span>
          <span>{risk.tiny_tld_saturation_trend || "n/a"}</span>
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted-foreground">Core dominance</span>
          <span>{risk.core_dominance || "n/a"}</span>
        </p>
      </div>
    </div>
  );
}
