"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Gauge, GitCompareArrows, LineChart, ScanSearch } from "lucide-react";

import { track } from "@/lib/analytics/ga";

type MarketMapRow = {
  tld: string;
  count: number;
  share_pct: number;
  delta_pct: number;
  delta_7d_pct?: number;
  delta_30d_pct?: number;
  anomaly_score?: number;
  sector?: string;
};

type RadarRow = {
  tld: string;
  growth_pct: number;
  volatility?: number;
  anomaly_score?: number;
  count: number;
  sector?: string;
};

type SectorIndex = {
  sector: string;
  total_delegated: number;
  delta_7d_pct?: number;
  delta_30d_pct?: number;
  volatility?: number;
  series_30d?: Array<{ date_utc: string; sector_count: number }>;
};

type Scenario = "balanced" | "top3_contraction" | "mid_tier_expansion" | "new_tld_shock";

function toNum(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function structuralState(top10SharePct: number, dviScore: number): "stable" | "fragmenting" | "consolidating" | "speculative" {
  if (top10SharePct >= 70 || dviScore >= 72) return "consolidating";
  if (dviScore >= 50) return "speculative";
  if (top10SharePct <= 52) return "fragmenting";
  return "stable";
}

function vectorSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = toNum(a[i]);
    const y = toNum(b[i]);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0) return 0;
  return clamp(dot / denom, -1, 1);
}

function toneForSimilarity(value: number): string {
  if (value >= 0.75) return "bg-emerald-500/30 text-emerald-100";
  if (value >= 0.4) return "bg-cyan-500/20 text-cyan-100";
  if (value >= 0.1) return "bg-amber-500/20 text-amber-100";
  return "bg-rose-500/20 text-rose-100";
}

function anomalyBand(score: number): "0-1" | "1-2" | "2-3" | "3+" {
  if (score >= 3) return "3+";
  if (score >= 2) return "2-3";
  if (score >= 1) return "1-2";
  return "0-1";
}

function disclosureIcon(open: boolean) {
  return open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />;
}

export default function AdvancedAnalyticsLayer({
  marketRows,
  radarRows,
  sectorRows,
  baseDviScore,
  baseTop10SharePct,
  totalDelegated,
  delta7dAbs,
}: {
  marketRows: MarketMapRow[];
  radarRows: RadarRow[];
  sectorRows: SectorIndex[];
  baseDviScore: number;
  baseTop10SharePct: number;
  totalDelegated: number;
  delta7dAbs: number;
}) {
  const [scenario, setScenario] = useState<Scenario>("balanced");
  const [shockPct, setShockPct] = useState<number>(10);
  const [volShock, setVolShock] = useState<number>(15);
  const [showSimulation, setShowSimulation] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCorrelation, setShowCorrelation] = useState(false);
  const [clusterHighlight, setClusterHighlight] = useState(true);
  const [clusterDetected, setClusterDetected] = useState(false);

  const tldOptions = useMemo(
    () => marketRows.filter((row) => row && row.tld).slice(0, 100).map((row) => row.tld),
    [marketRows],
  );
  const [leftTld, setLeftTld] = useState<string>(tldOptions[0] || "xyz");
  const [rightTld, setRightTld] = useState<string>(tldOptions[1] || "app");

  const simulation = useMemo(() => {
    const sorted = [...marketRows]
      .filter((row) => row && row.tld)
      .map((row) => ({ ...row, count: Math.max(0, toNum(row.count)) }))
      .sort((a, b) => toNum(b.count) - toNum(a.count));
    if (!sorted.length) {
      return {
        total: 0,
        top10Share: 0,
        hhi: 0,
        dvi: 0,
        state: "stable" as const,
      };
    }

    const adjusted = sorted.map((row, idx) => {
      let multiplier = 1;
      if (scenario === "top3_contraction" && idx < 3) multiplier = 1 - shockPct / 100;
      else if (scenario === "mid_tier_expansion" && idx >= 3 && idx < 30) multiplier = 1 + shockPct / 100;
      else if (scenario === "new_tld_shock" && idx >= 30) multiplier = 1 + (shockPct / 100) * 0.5;
      return { ...row, count: Math.max(0, row.count * multiplier) };
    });

    const total = adjusted.reduce((sum, row) => sum + row.count, 0);
    const top10 = adjusted.slice(0, 10).reduce((sum, row) => sum + row.count, 0);
    const top10Share = total > 0 ? (top10 / total) * 100 : 0;
    const hhi = total > 0 ? adjusted.reduce((sum, row) => sum + Math.pow(row.count / total, 2), 0) : 0;
    const dvi = clamp(baseDviScore + (top10Share - baseTop10SharePct) * 0.6 + volShock * 0.35, 0, 100);
    return { total, top10Share, hhi, dvi, state: structuralState(top10Share, dvi) };
  }, [baseDviScore, baseTop10SharePct, marketRows, scenario, shockPct, volShock]);

  const compareRows = useMemo(() => {
    const byTld = new Map(marketRows.map((row) => [row.tld, row]));
    const byRadar = new Map(radarRows.map((row) => [row.tld, row]));
    const mk = (tld: string) => {
      const mapRow = byTld.get(tld);
      const radarRow = byRadar.get(tld);
      return {
        tld,
        sector: mapRow?.sector || radarRow?.sector || "other",
        count: toNum(mapRow?.count),
        sharePct: toNum(mapRow?.share_pct),
        growth7d: toNum(mapRow?.delta_7d_pct) * 100,
        growth30d: toNum(mapRow?.delta_30d_pct) * 100,
        volatility: toNum(radarRow?.volatility),
      };
    };
    return [mk(leftTld), mk(rightTld)];
  }, [leftTld, marketRows, radarRows, rightTld]);

  const correlation = useMemo(() => {
    const sectors = sectorRows.slice(0, 8);
    const vectors = new Map<string, number[]>();
    for (const row of sectors) {
      const seriesTail = (row.series_30d || []).slice(-10).map((item) => toNum(item.sector_count));
      const fallback = [toNum(row.delta_7d_pct), toNum(row.delta_30d_pct), toNum(row.volatility)];
      vectors.set(row.sector, seriesTail.length >= 3 ? seriesTail : fallback);
    }
    return sectors.map((left) => ({
      sector: left.sector,
      values: sectors.map((right) => ({
        sector: right.sector,
        value: vectorSimilarity(vectors.get(left.sector) || [0], vectors.get(right.sector) || [0]),
      })),
    }));
  }, [sectorRows]);

  const clusterMap = useMemo(() => {
    const names = correlation.map((row) => row.sector);
    const adjacency = new Map<string, Set<string>>();
    for (const row of correlation) {
      adjacency.set(row.sector, new Set());
      for (const value of row.values) {
        if (value.sector !== row.sector && value.value >= 0.72) adjacency.get(row.sector)!.add(value.sector);
      }
    }
    const seen = new Set<string>();
    const out = new Map<string, number>();
    let clusterId = 0;
    for (const name of names) {
      if (seen.has(name)) continue;
      const stack = [name];
      while (stack.length) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        out.set(current, clusterId);
        for (const next of adjacency.get(current) || []) {
          if (!seen.has(next)) stack.push(next);
        }
      }
      clusterId += 1;
    }
    return out;
  }, [correlation]);

  const clusterGroups = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const [sector, cluster] of clusterMap.entries()) {
      if (!groups.has(cluster)) groups.set(cluster, []);
      groups.get(cluster)!.push(sector);
    }
    return [...groups.entries()].map(([id, sectors]) => ({ id, sectors }));
  }, [clusterMap]);

  const anomalyHeat = useMemo(() => {
    const out = new Map<string, Record<"0-1" | "1-2" | "2-3" | "3+", number>>();
    for (const row of marketRows.slice(0, 260)) {
      const sector = (row.sector || "other").toLowerCase();
      if (!out.has(sector)) out.set(sector, { "0-1": 0, "1-2": 0, "2-3": 0, "3+": 0 });
      out.get(sector)![anomalyBand(toNum(row.anomaly_score))] += 1;
    }
    return [...out.entries()].map(([sector, bands]) => ({ sector, bands }));
  }, [marketRows]);

  const projected30d = useMemo(() => {
    const baseDaily = delta7dAbs / 7;
    const shockMultiplier = 1 + volShock / 100;
    return Math.max(0, totalDelegated + baseDaily * 30 * shockMultiplier);
  }, [delta7dAbs, totalDelegated, volShock]);

  const summary = useMemo(() => {
    const [first, second] = compareRows;
    return `STRUCTURAL BRIEF: regime ${simulation.state.toUpperCase()}, Top10 ${fmtPct(
      simulation.top10Share,
    )}, projected 30d delegated ${fmtInt(projected30d)}. Compare .${first.tld} (${fmtPct(
      first.growth30d,
    )} 30d) vs .${second.tld} (${fmtPct(second.growth30d)} 30d).`;
  }, [compareRows, projected30d, simulation.state, simulation.top10Share]);

  return (
    <section className="rf-glass rounded-3xl p-5 md:p-6">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Model-driven scenario and correlation intelligence</p>
        <h2 className="font-display text-2xl font-semibold">STRUCTURAL ANALYSIS LAB</h2>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/25 px-2.5 py-1 hover:border-primary/40"
          onClick={() => setShowSimulation((prev) => !prev)}
        >
          {disclosureIcon(showSimulation)} Simulation Lab
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/25 px-2.5 py-1 hover:border-primary/40"
          onClick={() => setShowAdvanced((prev) => !prev)}
        >
          {disclosureIcon(showAdvanced)} Advanced Analytics
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/25 px-2.5 py-1 hover:border-primary/40"
          onClick={() => setShowCorrelation((prev) => !prev)}
        >
          {disclosureIcon(showCorrelation)} Correlation Engine
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-foreground hover:border-primary/60"
          onClick={() => {
            setShowCorrelation(true);
            setClusterHighlight(true);
            setClusterDetected(true);
            track("rf_market_filter", { filter_key: "correlation_detect_clusters", value: "run" });
          }}
        >
          Detect Clusters
        </button>
      </div>

      {showSimulation ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr,1fr]">
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/18 p-3">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 text-primary" /> Stress controls
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(
                [
                  ["balanced", "Balanced"],
                  ["top3_contraction", "Top3 contraction"],
                  ["mid_tier_expansion", "Mid-tier expansion"],
                  ["new_tld_shock", "New TLD shock"],
                ] as Array<[Scenario, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-md border px-2.5 py-1 ${
                    scenario === key
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border/70 bg-background/30 text-muted-foreground"
                  }`}
                  onClick={() => {
                    setScenario(key);
                    track("rf_market_filter", { filter_key: "stress_scenario", value: key });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="block text-xs">
              scenario magnitude <span className="rf-mono-digits">{shockPct.toFixed(0)}%</span>
              <input
                type="range"
                min={0}
                max={35}
                step={1}
                value={shockPct}
                className="mt-1 w-full accent-fuchsia-400"
                onChange={(event) => setShockPct(toNum(event.target.value, 10))}
              />
            </label>
            <label className="block text-xs">
              volatility shock <span className="rf-mono-digits">{volShock.toFixed(0)}%</span>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={volShock}
                className="mt-1 w-full accent-amber-400"
                onChange={(event) => {
                  setVolShock(toNum(event.target.value, 15));
                  track("volatility_toggle", { chart: "shock_simulator", range_days: toNum(event.target.value, 15) });
                }}
              />
            </label>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-background/18 p-3">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <ScanSearch className="h-3.5 w-3.5 text-primary" /> Real-time impact preview
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <p className="rounded border border-border/70 bg-background/30 px-2 py-1">New HHI: {simulation.hhi.toFixed(4)}</p>
              <p className="rounded border border-border/70 bg-background/30 px-2 py-1">New state: {simulation.state}</p>
              <p className="rounded border border-border/70 bg-background/30 px-2 py-1">Projected DVI: {simulation.dvi.toFixed(1)}</p>
              <p className="rounded border border-border/70 bg-background/30 px-2 py-1">Top10 share: {fmtPct(simulation.top10Share)}</p>
              <p className="col-span-2 rounded border border-border/70 bg-background/30 px-2 py-1">
                Projected 30d delegated: <span className="rf-mono-digits">{fmtInt(projected30d)}</span>
              </p>
            </div>
            <div className="rounded-lg border border-cyan-400/35 bg-cyan-500/8 p-2 text-xs">
              <p className="mb-1 uppercase tracking-[0.12em] text-muted-foreground">Impact summary</p>
              <p>Projected DVI: <span className="rf-mono-digits">{simulation.dvi.toFixed(1)}</span></p>
              <p>Projected HHI: <span className="rf-mono-digits">{simulation.hhi.toFixed(4)}</span></p>
              <p>Regime shift: <span className="uppercase">{simulation.state}</span></p>
            </div>
            <p className="rounded-lg border border-primary/25 bg-primary/8 px-2 py-1.5 text-xs text-foreground">{summary}</p>
          </div>
        </div>
      ) : null}

      {showAdvanced ? (
        <div className="mt-3 rounded-xl border border-border/60 bg-background/18 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <GitCompareArrows className="h-3.5 w-3.5 text-primary" /> TLD compare mode
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="rounded-md border border-border/70 bg-background/30 px-2 py-1.5 text-xs"
              value={leftTld}
              onChange={(event) => {
                setLeftTld(event.target.value);
                track("rf_tld_compare_add", { tld: event.target.value });
              }}
            >
              {tldOptions.map((tld) => (
                <option key={`left-${tld}`} value={tld}>
                  .{tld}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border/70 bg-background/30 px-2 py-1.5 text-xs"
              value={rightTld}
              onChange={(event) => {
                setRightTld(event.target.value);
                track("rf_tld_compare_add", { tld: event.target.value });
              }}
            >
              {tldOptions.map((tld) => (
                <option key={`right-${tld}`} value={tld}>
                  .{tld}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {compareRows.map((row) => (
              <div key={row.tld} className="rounded-lg border border-border/70 bg-background/30 p-2 text-xs">
                <p className="font-display text-base font-semibold">.{row.tld}</p>
                <p>Sector: {row.sector}</p>
                <p>Delegated: <span className="rf-mono-digits">{fmtInt(row.count)}</span></p>
                <p>Share: <span className="rf-mono-digits">{fmtPct(row.sharePct)}</span></p>
                <p>7d: <span className="rf-mono-digits">{fmtPct(row.growth7d)}</span></p>
                <p>30d: <span className="rf-mono-digits">{fmtPct(row.growth30d)}</span></p>
                <p>Volatility: <span className="rf-mono-digits">{row.volatility.toFixed(4)}</span></p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCorrelation ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border/60 bg-background/18 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <LineChart className="h-3.5 w-3.5 text-primary" /> Sector correlation matrix
            </p>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={clusterHighlight}
                  onChange={() => setClusterHighlight((prev) => !prev)}
                />
                cluster highlight
              </label>
              <button
                type="button"
                className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px]"
                onClick={() => {
                  setClusterDetected(true);
                  setClusterHighlight(true);
                  track("rf_market_filter", { filter_key: "cluster_detect", value: "manual" });
                }}
              >
                Detect clusters
              </button>
            </div>
          </div>

          <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
            <p className="rounded border border-border/60 bg-background/30 px-2 py-1">Legend: &ge; 0.75 strong</p>
            <p className="rounded border border-border/60 bg-background/30 px-2 py-1">0.40-0.74 moderate</p>
            <p className="rounded border border-border/60 bg-background/30 px-2 py-1">0.10-0.39 weak</p>
            <p className="rounded border border-border/60 bg-background/30 px-2 py-1">&lt; 0.10 inverse/none</p>
          </div>

          <p className="text-xs text-muted-foreground">
            Auto-cluster detection:{" "}
            {clusterDetected
              ? clusterGroups.map((group) => `C${group.id + 1}[${group.sectors.join(", ")}]`).join(" | ")
              : "Run detect clusters to highlight structural co-movement groups."}
          </p>

          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-muted-foreground">Sector</th>
                  {correlation.map((row) => (
                    <th key={`head-${row.sector}`} className="px-2 py-1 text-left text-muted-foreground">
                      {row.sector}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlation.map((row) => (
                  <tr key={`row-${row.sector}`}>
                    <td className="px-2 py-1 font-medium">{row.sector}</td>
                    {row.values.map((item) => {
                      const sameCluster = clusterMap.get(row.sector) === clusterMap.get(item.sector);
                      return (
                        <td
                          key={`${row.sector}-${item.sector}`}
                          className={`px-2 py-1 ${clusterHighlight && !sameCluster ? "opacity-35" : ""}`}
                        >
                          <span className={`inline-flex rounded px-1.5 py-0.5 ${toneForSimilarity(item.value)}`}>
                            {item.value.toFixed(2)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Structural anomaly heatmap</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {anomalyHeat.slice(0, 9).map((row) => (
                <div key={row.sector} className="rounded-lg border border-border/70 bg-background/30 p-2 text-xs">
                  <p className="mb-1 font-medium uppercase">{row.sector}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {(["0-1", "1-2", "2-3", "3+"] as const).map((band) => {
                      const val = row.bands[band];
                      const tone =
                        band === "3+"
                          ? "bg-red-500/20 text-red-100"
                          : band === "2-3"
                            ? "bg-fuchsia-500/20 text-fuchsia-100"
                            : band === "1-2"
                              ? "bg-amber-500/20 text-amber-100"
                              : "bg-cyan-500/20 text-cyan-100";
                      return (
                        <div key={`${row.sector}-${band}`} className={`rounded px-1.5 py-1 text-center ${tone}`}>
                          <p className="text-[10px]">{band}</p>
                          <p className="rf-mono-digits text-sm">{val}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
