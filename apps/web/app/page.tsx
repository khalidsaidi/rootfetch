import Link from "next/link";
import { AlertTriangle, Bot, Download, ShieldCheck, Sparkles, Waves } from "lucide-react";

import AnomalyTiles from "@/components/AnomalyTiles";
import CadenceLegend from "@/components/CadenceLegend";
import DownloadLinkButton from "@/components/DownloadLinkButton";
import HomeViewTracker from "@/components/HomeViewTracker";
import McpSnippet from "@/components/McpSnippet";
import MarketRiskPanel from "@/components/MarketRiskPanel";
import SecurityStatusCard from "@/components/SecurityStatusCard";
import SectorIndexGrid from "@/components/SectorIndexGrid";
import SnapshotExplainer from "@/components/SnapshotExplainer";
import StatCard from "@/components/StatCard";
import ThemeToggle from "@/components/ThemeToggle";
import TrackedLink from "@/components/TrackedLink";
import VolatilityGauge from "@/components/VolatilityGauge";
import DelegationRadarChart from "@/components/charts/DelegationRadarChart";
import MarketTreemap from "@/components/charts/MarketTreemap";
import PowerCurveChart from "@/components/charts/PowerCurveChart";
import PulseSeriesChart from "@/components/charts/PulseSeriesChart";
import {
  loadApprovalsDiffLatest,
  loadConcentrationLatest,
  loadCoverage,
  loadDigestSnippet,
  loadDistributionLatest,
  loadLatest,
  loadSecurityStatusLatest,
  loadTopTldsCsv,
} from "@/lib/rootfetch-data";

function asNumber(value: unknown): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function fmtInt(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function fmtRatio(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSigned(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtInt(value)}`;
}

function riskTone(level?: string): string {
  if (level === "high") return "text-rose-300";
  if (level === "elevated") return "text-amber-300";
  return "text-cyan-300";
}

export default async function Home() {
  const [
    latest,
    coverage,
    topCsv,
    distributionFallback,
    concentrationFallback,
    approvalsFallback,
    securityFallback,
    digestSnippet,
  ] = await Promise.all([
    loadLatest(),
    loadCoverage(),
    loadTopTldsCsv(),
    loadDistributionLatest(),
    loadConcentrationLatest(),
    loadApprovalsDiffLatest(),
    loadSecurityStatusLatest(),
    loadDigestSnippet(30),
  ]);

  const approved = coverage.approved_tlds_count || latest.approved_tlds_count || 0;
  const observedToday = latest.counted_today_count ?? 0;
  const coreToday = latest.counted_today_core_count ?? coverage.counted_today_core_count ?? 0;
  const rollingToday = latest.counted_today_rolling_count ?? coverage.counted_today_rolling_count ?? 0;
  const snapshotRowsToday =
    latest.snapshot_rows_today ?? latest.processed_tlds_count_today ?? coverage.counted_today_count ?? 0;
  const countedEver = coverage.counted_ever_count ?? 0;
  const missingEver = coverage.missing_ever_count ?? Math.max(0, approved - countedEver);
  const coveragePct = approved > 0 ? countedEver / approved : 0;

  const topRows = latest.top_tlds && latest.top_tlds.length > 0 ? latest.top_tlds : topCsv;
  const distribution = {
    ...distributionFallback,
    ...(latest.distribution || {}),
  } as Record<string, unknown>;
  const concentration = {
    ...concentrationFallback,
    ...(latest.concentration || {}),
  } as Record<string, unknown>;
  const approvalsDiff = {
    ...approvalsFallback,
    ...(latest.approvals_diff || {}),
  } as Record<string, unknown>;
  const securityStatus = {
    ...securityFallback,
    ...(latest.security_status || {}),
  } as Record<string, unknown>;

  const totalDelegated = asNumber(latest.total_delegated_counted_today || latest.total_delegated_domains_today);
  const top1Share = asNumber(concentration.top1_share_pct);
  const top10Share = asNumber(concentration.top10_share_pct);
  const hhi = asNumber(concentration.hhi);

  const pulse = latest.pulse || {};
  const pulseSeries = Array.isArray(pulse.series_30d) ? pulse.series_30d : [];
  const dvi = latest.dvi || {};

  const anomalySpotlight = Array.isArray(latest.anomaly_spotlight) && latest.anomaly_spotlight.length > 0
    ? latest.anomaly_spotlight
    : (latest.anomalies || []).slice(0, 8).map((row) => ({
        tld: row.tld,
        count: 0,
        delta_abs: 0,
        delta_pct: row.delta_pct || 0,
        robust_z: row.robust_z || 0,
        z_score: row.z || 0,
        label: row.reason || "signal",
        intensity: "medium",
        sector: "other",
      }));

  const marketMapRows = Array.isArray(latest.market_map) && latest.market_map.length > 0
    ? latest.market_map
    : topRows.slice(0, 160).map((row) => ({
        tld: row.tld,
        count: row.count,
        share_pct: row.share_pct,
        delta_abs: 0,
        delta_pct: 0,
        anomaly_score: 0,
        sector: row.sector || "other",
      }));

  const radarRows = Array.isArray(latest.radar_points) && latest.radar_points.length > 0
    ? latest.radar_points
    : marketMapRows.slice(0, 180).map((row) => ({
        tld: row.tld,
        growth_pct: Number(row.delta_pct || 0) * 100.0,
        volatility: 0,
        anomaly_score: Number(row.anomaly_score || 0),
        count: row.count,
        sector: row.sector || "other",
      }));

  const marketRisk = latest.market_risk || {
    concentration_risk: top10Share >= 68 ? "high" : top10Share >= 55 ? "moderate" : "low",
    concentration_score: Math.min(100, top10Share * 0.85 + hhi * 250),
    top10_share_pct: top10Share,
    top3_share_pct: asNumber(concentration.top3_share_pct),
    hhi,
    fragmentation: top10Share >= 68 ? "low" : top10Share >= 55 ? "moderate" : "high",
    tiny_tld_saturation_trend: "stable",
    core_dominance: "stable",
  };

  const powerCurve = latest.power_curve || { today: [], d30: [], d90: [] };
  const sectorIndices = Array.isArray(latest.sector_indices) ? latest.sector_indices : [];
  const insights = Array.isArray(latest.insights) ? latest.insights : [];
  const approvalsAdded = Array.isArray(approvalsDiff.added_preview)
    ? approvalsDiff.added_preview
    : Array.isArray(approvalsDiff.added_first_10)
      ? approvalsDiff.added_first_10
      : [];

  const jsonLdSoftware = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "RootFetch Delegation Intelligence Engine",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app",
    description:
      "Read-only delegation intelligence from locally ingested CZDS data: market structure, anomaly signals, sector indices, and AI-ready artifacts.",
  };

  const jsonLdDataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "RootFetch Delegation Snapshot",
    description: "Daily TLD delegation counts and market structure signals derived from local CZDS ingestion.",
    distribution: [
      { "@type": "DataDownload", contentUrl: "/rootfetch/latest.json", encodingFormat: "application/json" },
      { "@type": "DataDownload", contentUrl: "/rootfetch/top_tlds_latest.csv", encodingFormat: "text/csv" },
      { "@type": "DataDownload", contentUrl: "/rootfetch/concentration_latest.json", encodingFormat: "application/json" },
    ],
  };

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 pb-16 pt-6 md:px-8">
      <HomeViewTracker />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSoftware) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdDataset) }} />

      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/70 p-5 shadow-glow backdrop-blur md:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_95%,hsl(var(--border)/0.5)_96%),linear-gradient(90deg,transparent_95%,hsl(var(--border)/0.5)_96%)] bg-[size:26px_26px]" />
        <div className="pointer-events-none absolute -left-24 top-8 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-8 h-64 w-64 rounded-full bg-fuchsia-500/12 blur-3xl" />

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Delegation Intelligence Console</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              RootFetch maps structural movement in the global namespace
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-muted-foreground md:text-base">
              Local-only CZDS ingestion, no raw zones stored, Vercel read-only serving committed aggregates and AI-ready artifacts.
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 text-xs">
          <TrackedLink href="/approved" label="nav_approved" pageType="home" eventName="rf_open_approved" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Approved TLDs
          </TrackedLink>
          <TrackedLink href="/sectors" label="nav_sectors" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Sector indices
          </TrackedLink>
          <TrackedLink href="/compare" label="nav_compare" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Compare
          </TrackedLink>
          <TrackedLink href="/ask" label="nav_ask" pageType="home" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Ask RootFetch
          </TrackedLink>
          <TrackedLink href="/api/latest" label="nav_json" pageType="home" eventName="rf_open_json_api" className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            JSON API
          </TrackedLink>
        </div>

        <div className="relative z-10 mt-5 grid gap-4 xl:grid-cols-[1.15fr,1fr,0.9fr]">
          <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <Waves className="h-3.5 w-3.5 text-cyan-300" /> Live delegation pulse
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <StatCard label="Total delegated" value={Number(pulse.total_delegated_today || totalDelegated)} />
              <StatCard label="Δ today" value={fmtSigned(Number(pulse.delta_abs_today || 0))} />
              <StatCard label="7-day delta" value={fmtSigned(Number(pulse.rolling_7d_delta_abs || 0))} />
              <StatCard
                label="Observed today"
                value={observedToday}
                hint={`core ${fmtInt(coreToday)} + rolling ${fmtInt(rollingToday)}`}
                tooltip="Observed today = TLDs re-downloaded and recounted today."
              />
            </div>
            <div className="mt-3">
              <PulseSeriesChart rows={pulseSeries as Array<{ date_utc: string; total_delegated_count: number }>} />
            </div>
            <div className="mt-3">
              <VolatilityGauge dvi={dvi} />
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-fuchsia-300" /> Top anomalies today
            </div>
            <AnomalyTiles rows={anomalySpotlight} />
          </div>

          <div className="space-y-3">
            <MarketRiskPanel risk={marketRisk} />
            <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">New approvals today</p>
              <p className="mt-1 font-display text-2xl font-semibold">+{fmtInt(Number(approvalsDiff.added_count || 0))}</p>
              {approvalsAdded.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {approvalsAdded.slice(0, 12).map((tld) => (
                    <span key={String(tld)} className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5">
                      .{String(tld)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No new approvals in this snapshot.</p>
              )}
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Coverage + trust</p>
              <p className="mt-1 text-sm">
                Counted ever <span className="font-semibold">{fmtInt(countedEver)}</span> / Approved{" "}
                <span className="font-semibold">{fmtInt(approved)}</span>
              </p>
              <p className="text-sm text-muted-foreground">Missing ever: {fmtInt(missingEver)}</p>
              <p className={`mt-1 text-sm ${riskTone(String(dvi.level || "stable"))}`}>Volatility: {String(dvi.level || "stable")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Market structure layer</p>
            <h2 className="font-display text-2xl font-semibold">Interactive market map + power law curve</h2>
            <p className="text-sm text-muted-foreground">
              Treemap size = delegation count, color = movement. Power curve shows concentration shape across rank.
            </p>
          </div>
          <DownloadLinkButton
            href="/rootfetch/top_tlds_latest.csv"
            filename="rootfetch_top_tlds_latest.csv"
            label="Download top-TLD CSV"
            kind="top_tlds"
          />
        </div>
        <MarketTreemap rows={marketMapRows} />
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <StatCard label="Top 1 share" value={fmtPct(top1Share)} />
          <StatCard label="Top 10 share" value={fmtPct(top10Share)} />
          <StatCard label="HHI" value={hhi.toFixed(4)} />
          <StatCard label="Median TLD size" value={Number(distribution.p50 || 0)} />
        </div>
        <div className="mt-5">
          <h3 className="font-display text-lg font-semibold">Power curve (rank vs delegation count)</h3>
          <p className="text-xs text-muted-foreground">Toggle today / 30d / 90d to compare concentration shape.</p>
          <div className="mt-2">
            <PowerCurveChart curve={powerCurve} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Anomaly + volatility layer</p>
          <h2 className="font-display text-2xl font-semibold">Delegation radar</h2>
          <p className="text-sm text-muted-foreground">
            X-axis volatility, Y-axis growth, bubble size by delegated count. Highlights speculative vs stable movement.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.25fr,0.75fr]">
          <DelegationRadarChart rows={radarRows} />
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Core movers (abs)</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {(latest.core_movers_abs || []).slice(0, 8).map((row) => (
                  <li key={`${row.tld}-${row.delta_abs}`} className="flex items-center justify-between">
                    <TrackedLink href={`/tld/${row.tld}`} label={`core_${row.tld}`} pageType="home" eventName="rf_core_mover_click" eventParams={{ tld: row.tld }} className="font-medium hover:text-primary">
                      .{row.tld}
                    </TrackedLink>
                    <span className={Number(row.delta_abs || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtSigned(row.delta_abs)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Rolling updates</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {(latest.rolling_updates || []).slice(0, 8).map((row) => (
                  <li key={`${row.tld}-${row.prev_date_utc || "first"}`} className="flex items-center justify-between">
                    <TrackedLink href={`/tld/${row.tld}`} label={`rolling_${row.tld}`} pageType="home" eventName="rf_rolling_update_click" eventParams={{ tld: row.tld }} className="font-medium hover:text-primary">
                      .{row.tld}
                    </TrackedLink>
                    {!row.prev_date_utc ? (
                      <span className="text-amber-300">first seen</span>
                    ) : (
                      <span className={Number(row.delta_abs || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtSigned(row.delta_abs)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sector + index layer</p>
          <h2 className="font-display text-2xl font-semibold">Sector baskets and index movement</h2>
          <p className="text-sm text-muted-foreground">
            Each card tracks delegated totals, 7d/30d deltas, and volatility for sector baskets.
          </p>
        </div>
        <SectorIndexGrid rows={sectorIndices} />
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Trust + integrity layer</p>
            <h2 className="font-display text-2xl font-semibold">Data integrity and provenance</h2>
            <p className="text-sm text-muted-foreground">
              RootFetch never publishes raw zones, never commits secrets, and serves only committed aggregates.
            </p>
          </div>
          <SnapshotExplainer />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
          <SecurityStatusCard
            status={{
              date_utc: String(securityStatus.date_utc || ""),
              no_raw_zones_tracked: Boolean(securityStatus.no_raw_zones_tracked),
              no_ai_dir_tracked: Boolean(securityStatus.no_ai_dir_tracked),
              no_env_tracked: Boolean(securityStatus.no_env_tracked),
              last_local_run_id: String(securityStatus.last_local_run_id || latest.run_id || ""),
              vercel_read_only: Boolean(securityStatus.vercel_read_only),
            }}
          />
          <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Coverage semantics</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <StatCard label="Observed today" value={observedToday} hint={`core ${fmtInt(coreToday)} + rolling ${fmtInt(rollingToday)}`} />
              <StatCard label="Snapshot rows today" value={snapshotRowsToday} />
              <StatCard label="Coverage (counted ever)" value={fmtRatio(coveragePct)} />
              <StatCard label="Missing ever" value={missingEver} />
            </div>
            <div className="mt-3">
              <CadenceLegend />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">AI-native interface layer</p>
          <h2 className="font-display text-2xl font-semibold">Connect your agent</h2>
          <p className="text-sm text-muted-foreground">
            MCP endpoint + static RAG artifacts for deterministic retrieval, with optional Ask RootFetch UI for cited answers.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <div className="space-y-3 rounded-2xl border border-border/70 bg-background/45 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <TrackedLink href="/docs/mcp" label="mcp_docs_cta" pageType="home" eventName="rf_mcp_doc_open" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                <Bot className="h-4 w-4" /> Connect via MCP
              </TrackedLink>
              <TrackedLink href="/api/latest" label="latest_artifact_cta" pageType="home" eventName="rf_open_json_api" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                <Download className="h-4 w-4" /> Fetch artifact JSON
              </TrackedLink>
              <TrackedLink href="/ask" label="ask_scan_cta" pageType="home" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                <Sparkles className="h-4 w-4" /> Run delegation scan
              </TrackedLink>
              <TrackedLink href="/rootfetch/latest.md" label="digest_cta" pageType="home" eventName="rf_open_digest" extraEventNames={["rf_read_digest"]} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                <ShieldCheck className="h-4 w-4" /> Generate market digest
              </TrackedLink>
            </div>
            <pre className="max-h-[300px] overflow-auto rounded-xl border border-border/70 bg-black/60 p-3 font-mono text-xs text-emerald-300">
{`$ curl https://rootfetch.vercel.app/api/latest
{
  "date_utc": "${latest.date_utc}",
  "approved_tlds_count": ${approved},
  "counted_today_count": ${observedToday},
  "top10_share_pct": ${top10Share.toFixed(2)},
  "dvi_score": ${Number(dvi.score || 0).toFixed(2)}
}`}
            </pre>
          </div>
          <McpSnippet siteUrl={process.env.NEXT_PUBLIC_SITE_URL} />
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur md:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Intelligence briefing</p>
            <h2 className="font-display text-2xl font-semibold">Signal summary + digest preview</h2>
          </div>
          <TrackedLink href="/rootfetch/latest.md" label="open_digest_bottom" pageType="home" eventName="rf_open_digest" extraEventNames={["rf_read_digest"]} className="text-sm text-primary hover:text-primary/80">
            Open full digest
          </TrackedLink>
        </div>
        {insights.length > 0 ? (
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            {insights.slice(0, 4).map((item, idx) => (
              <div key={`${item.kind}-${idx}`} className="rounded-xl border border-border/70 bg-background/45 p-3 text-sm">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {item.kind} / {item.severity}
                </p>
                <p className="mt-1">{item.text}</p>
              </div>
            ))}
          </div>
        ) : null}
        <pre className="max-h-[360px] overflow-auto rounded-xl border border-border/70 bg-background/60 p-4 font-mono text-xs leading-relaxed">
          {digestSnippet}
        </pre>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-muted-foreground">
        <p>RootFetch ingestion runs locally only. Vercel remains read-only.</p>
        <div className="flex items-center gap-3">
          <Link href="/about" className="hover:text-foreground">
            about
          </Link>
          <Link href="/methodology" className="hover:text-foreground">
            methodology
          </Link>
          <Link href="/security" className="hover:text-foreground">
            security
          </Link>
          <Link href="/llms.txt" className="hover:text-foreground">
            llms.txt
          </Link>
        </div>
      </footer>
    </main>
  );
}
