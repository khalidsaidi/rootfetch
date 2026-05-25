import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Bot,
  Database,
  FolderTree,
  Shield,
  TerminalSquare,
} from "lucide-react";

import AdvancedAnalyticsLayer from "@/components/home/AdvancedAnalyticsLayer";
import CopyValueButton from "@/components/CopyValueButton";
import HomeViewTracker from "@/components/HomeViewTracker";
import JsonArtifactPreview from "@/components/JsonArtifactPreview";
import McpSnippet from "@/components/McpSnippet";
import LiveIntelligenceZoneClient from "@/components/home/LiveIntelligenceZoneClient";
import { ReplayTimelineProvider } from "@/components/home/ReplayTimelineContext";
import TrackedLink from "@/components/TrackedLink";
import {
  SectorIndexGridClient as SectorIndexGrid,
} from "@/components/home/HomeClientCharts";
import StructuralAnalysisLayer from "@/components/home/StructuralAnalysisLayer";
import {
  loadCoverage,
  loadDigestSnippet,
  loadDigestSnippetForRun,
  loadLatest,
  loadPublishedRunBundle,
  loadReplayIndex,
  loadRunBundleById,
} from "@/lib/rootfetch-data";
import { loadRootfetchPublicStats } from "@/lib/public-stats";

export const dynamic = "force-dynamic";

function asNumber(value: unknown): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function fmtInt(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSignedInt(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  const rounded = Math.trunc(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US").format(rounded)}`;
}

function marketState(top10SharePct: number, dviScore: number): "stable" | "fragmenting" | "consolidating" | "speculative" {
  if (top10SharePct >= 70 || dviScore >= 72) return "consolidating";
  if (dviScore >= 50) return "speculative";
  if (top10SharePct <= 52) return "fragmenting";
  return "stable";
}

function timeSince(isoLike: string | undefined | null): string {
  if (!isoLike) return "n/a";
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  const ms = Date.now() - parsed.getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export async function generateMetadata(): Promise<Metadata> {
  const stats = await loadRootfetchPublicStats();
  const description =
    `Delegation intelligence with live counters: ${stats.mcp_calls_7d} MCP calls (7d), ` +
    `${stats.unique_callers_7d} unique callers (7d), snapshot freshness ${stats.snapshot_freshness_label}.`;
  return {
    description,
    openGraph: {
      title: "RootFetch | Delegation Intelligence",
      description,
    },
    twitter: {
      card: "summary_large_image",
      title: "RootFetch | Delegation Intelligence",
      description,
    },
  };
}

export default async function Home() {
  const publicStats = await loadRootfetchPublicStats();
  const published = await loadPublishedRunBundle();
  const [fallbackLatest, fallbackCoverage, digestSnippet] = await Promise.all([
    published ? Promise.resolve(null) : loadLatest(),
    published ? Promise.resolve(null) : loadCoverage(),
    published ? loadDigestSnippetForRun(published.signals.run_id, 26) : loadDigestSnippet(26),
  ]);
  const latest = published?.signals ?? fallbackLatest!;
  const coverage = published?.coverage ?? fallbackCoverage!;

  const approved = coverage.approved_tlds_count || latest.approved_tlds_count || 0;
  const observedToday = latest.counted_today_count ?? 0;
  const coreToday = latest.counted_today_core_count ?? coverage.counted_today_core_count ?? 0;
  const rollingToday = latest.counted_today_rolling_count ?? coverage.counted_today_rolling_count ?? 0;
  const snapshotRowsToday =
    latest.snapshot_rows_today ?? latest.processed_tlds_count_today ?? coverage.counted_today_count ?? 0;
  const countedEver = coverage.counted_ever_count ?? 0;
  const missingEver = coverage.missing_ever_count ?? Math.max(0, approved - countedEver);
  const coveragePct = approved > 0 ? countedEver / approved : 0;

  const topRows = Array.isArray(latest.top_tlds) ? latest.top_tlds : [];
  const distribution = { ...(latest.distribution || {}) } as Record<string, unknown>;
  const concentration = { ...(latest.concentration || {}) } as Record<string, unknown>;
  const approvalsDiff = { ...(latest.approvals_diff || {}) } as Record<string, unknown>;
  const securityStatus = { ...(latest.security_status || {}) } as Record<string, unknown>;

  const pulse = latest.pulse || {};
  const totalDelegated = asNumber(
    pulse.total_delegated_today || latest.total_delegated_counted_today || latest.total_delegated_domains_today,
  );
  const deltaTodayAbs = asNumber(pulse.delta_abs_today);
  const delta7dAbs = asNumber(pulse.rolling_7d_delta_abs);
  const delta7dPct = asNumber(pulse.rolling_7d_delta_pct);
  const pulseSeries = Array.isArray(pulse.series_30d) ? pulse.series_30d : [];
  const dvi = latest.dvi || {};
  const dviScore = asNumber(dvi.score);
  const top10SharePct = asNumber(concentration.top10_share_pct);

  const state = marketState(top10SharePct, dviScore);

  const anomalyRows = Array.isArray(latest.anomaly_spotlight) && latest.anomaly_spotlight.length > 0
    ? latest.anomaly_spotlight
        .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
        .map((row) => ({
          tld: row.tld,
          delta_abs: Number(row.delta_abs || 0),
          delta_pct: Number(row.delta_pct || 0),
          robust_z: row.robust_z == null ? undefined : Number(row.robust_z),
          z_score: row.z_score == null ? undefined : Number(row.z_score),
          anomaly_score: row.anomaly_score == null ? undefined : Number(row.anomaly_score),
          volatility: row.volatility == null ? undefined : Number(row.volatility),
          count: Number(row.count || 0),
          sector: row.sector || "other",
          label: row.label || "signal",
        }))
    : (latest.anomalies || []).slice(0, 12).map((row) => ({
        tld: row.tld,
        delta_abs: 0,
        delta_pct: Number(row.delta_pct || 0),
        robust_z: row.robust_z == null ? undefined : Number(row.robust_z),
        z_score: row.z == null ? undefined : Number(row.z),
        anomaly_score: undefined,
        volatility: undefined,
        count: 0,
        sector: "other",
        label: row.reason || "signal",
      }));

  const marketMapRows = Array.isArray(latest.market_map) && latest.market_map.length > 0
    ? latest.market_map
        .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
        .map((row) => ({
          tld: row.tld,
          count: Number(row.count || 0),
          share_pct: Number(row.share_pct || 0),
          delta_abs: Number(row.delta_abs || 0),
          delta_pct: Number(row.delta_pct || 0),
          delta_7d_abs: Number(row.delta_7d_abs || 0),
          delta_30d_abs: Number(row.delta_30d_abs || 0),
          delta_7d_pct: Number(row.delta_7d_pct || 0),
          delta_30d_pct: Number(row.delta_30d_pct || 0),
          anomaly_score: Number(row.anomaly_score || 0),
          sector: row.sector || "other",
        }))
    : topRows.slice(0, 180).map((row) => ({
        tld: row.tld,
        count: row.count,
        share_pct: row.share_pct,
        delta_abs: 0,
        delta_pct: 0,
        delta_7d_abs: 0,
        delta_30d_abs: 0,
        delta_7d_pct: 0,
        delta_30d_pct: 0,
        anomaly_score: 0,
        sector: row.sector || "other",
      }));

  const radarRows = Array.isArray(latest.radar_points) && latest.radar_points.length > 0
    ? latest.radar_points
        .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
        .map((row) => {
        const mapRow = marketMapRows.find((item) => item.tld === row.tld);
        return {
          ...row,
          growth_pct: Number(row.growth_pct || 0),
          volatility: Number(row.volatility || 0),
          anomaly_score: Number(row.anomaly_score || 0),
          count: Number(row.count || 0),
          sector: row.sector || "other",
          growth_7d_pct: Number((mapRow as { delta_7d_pct?: number } | undefined)?.delta_7d_pct || 0) * 100.0,
          growth_30d_pct: Number((mapRow as { delta_30d_pct?: number } | undefined)?.delta_30d_pct || 0) * 100.0,
        };
      })
    : marketMapRows.slice(0, 200).map((row) => ({
        tld: row.tld,
        growth_pct: Number(row.delta_pct || 0) * 100.0,
        growth_7d_pct: Number(row.delta_7d_pct || 0) * 100.0,
        growth_30d_pct: Number(row.delta_30d_pct || 0) * 100.0,
        volatility: 0,
        anomaly_score: Number(row.anomaly_score || 0),
        count: row.count,
        sector: row.sector || "other",
      }));

  const marketRisk = latest.market_risk || {
    concentration_risk: top10SharePct >= 68 ? "high" : top10SharePct >= 55 ? "moderate" : "low",
    concentration_score: Math.min(100, top10SharePct * 0.85 + asNumber(concentration.hhi) * 250),
    top10_share_pct: top10SharePct,
    top3_share_pct: asNumber(concentration.top3_share_pct),
    hhi: asNumber(concentration.hhi),
    fragmentation: top10SharePct >= 68 ? "low" : top10SharePct >= 55 ? "moderate" : "high",
    tiny_tld_saturation_trend: "stable",
    core_dominance: "stable",
  };

  const powerCurve = latest.power_curve || { today: [], d30: [], d90: [] };
  const sectorIndices = Array.isArray(latest.sector_indices)
    ? latest.sector_indices
        .filter((row) => row && typeof row.sector === "string")
        .map((row) => ({
          sector: row.sector,
          total_delegated: Number(row.total_delegated || 0),
          delta_7d_pct: row.delta_7d_pct == null ? undefined : Number(row.delta_7d_pct),
          delta_30d_pct: row.delta_30d_pct == null ? undefined : Number(row.delta_30d_pct),
          volatility: row.volatility == null ? undefined : Number(row.volatility),
          series_30d: Array.isArray(row.series_30d)
            ? row.series_30d
                .filter((item) => item && typeof item.date_utc === "string")
                .map((item) => ({
                  date_utc: item.date_utc,
                  sector_count: Number(item.sector_count || 0),
                }))
            : [],
        }))
    : [];
  const snapshotHash = createHash("sha256")
    .update(
      JSON.stringify({
        date_utc: latest.date_utc,
        run_id: latest.run_id,
        approved_tlds_count: approved,
        snapshot_rows_today: snapshotRowsToday,
      }),
    )
    .digest("hex")
    .slice(0, 18);
  const checkedAtUtc = String(securityStatus.checked_at_utc || "");
  const lastSnapshotAgo = timeSince(checkedAtUtc);

  const approvalsAdded = Array.isArray(approvalsDiff.added_preview)
    ? approvalsDiff.added_preview
    : Array.isArray(approvalsDiff.added_first_10)
      ? approvalsDiff.added_first_10
      : [];
  const activeRunId = String(published?.pointer.run_id || latest.run_id || "n/a");
  const modelVersion = String(
    (published?.pointer.model_version as string | undefined) || (latest.model_version as string | undefined) || "n/a",
  );
  const manifestFiles = Array.isArray((published?.manifest as { files?: Array<Record<string, unknown>> } | undefined)?.files)
    ? ((published?.manifest as { files: Array<Record<string, unknown>> }).files)
    : [];
  const manifestVerified =
    manifestFiles.length > 0 &&
    manifestFiles.every((entry) => typeof entry.sha256 === "string" && String(entry.sha256).length === 64);
  const manifestHref = activeRunId && activeRunId !== "n/a"
    ? `/rootfetch/artifacts/runs/${encodeURIComponent(activeRunId)}/manifest.json`
    : "/rootfetch/artifacts/latest.json";
  const replayIndex = await loadReplayIndex();
  const replayRuns = Array.isArray(replayIndex.runs) ? replayIndex.runs : [];
  const orderedReplayRuns = [...replayRuns].sort((a, b) =>
    String(b.snapshot_ts_utc || "").localeCompare(String(a.snapshot_ts_utc || "")),
  );
  const previousRunId =
    orderedReplayRuns.find((row) => String(row.run_id || "") !== activeRunId)?.run_id || "";
  const previousRunBundle = previousRunId ? await loadRunBundleById(previousRunId) : null;
  const previousManifestSha = previousRunBundle?.manifestSha256 || "n/a";
  const previousModelVersion = String((previousRunBundle?.model?.model_version as string | undefined) || "n/a");
  const activeRunForHref = activeRunId && activeRunId !== "n/a" ? activeRunId : "";
  const activeManifestSha =
    (published?.manifestSha256 && String(published.manifestSha256).trim()) ||
    createHash("sha256").update(JSON.stringify(published?.manifest || {})).digest("hex");
  const compareLatestHref = previousRunId
    ? `/compare?left=${encodeURIComponent(previousRunId)}&right=${encodeURIComponent(activeRunForHref || "latest")}`
    : "/compare";
  const latestCitationSnippet = [
    "RootFetch Structural Evidence",
    `left_run_id: ${previousRunId || "n/a"}`,
    `right_run_id: ${activeRunForHref || "latest"}`,
    `left_model_version: ${previousModelVersion}`,
    `right_model_version: ${modelVersion}`,
    `left_manifest_sha256: ${previousManifestSha}`,
    `right_manifest_sha256: ${activeManifestSha}`,
    `compare_url: ${compareLatestHref}`,
    `run_url: ${activeRunForHref ? `/runs/${encodeURIComponent(activeRunForHref)}` : "/runs"}`,
  ].join("\n");

  const jsonLdSoftware = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "RootFetch Delegation Intelligence Engine",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com",
    description:
      "Infrastructure-grade delegation intelligence console powered by local CZDS ingestion and read-only committed artifacts.",
  };

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-16 pt-5 md:px-8">
      <HomeViewTracker />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSoftware) }} />

      <section className="rf-glass rounded-3xl p-5 md:p-8">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">RootFetch</p>
        <h1 className="mt-2 max-w-5xl font-display text-[2rem] font-semibold leading-[1.14] md:text-[2.7rem]">
          Delegation intelligence from DNS-visible evidence.
        </h1>
        <p className="mt-4 max-w-5xl text-[0.98rem] leading-7 text-muted-foreground md:text-[1.08rem]">
          RootFetch ingests CZDS zone snapshots locally, computes a versioned volatility index and structural regime
          classification, then publishes immutable, auditable artifacts for humans and agents.
        </p>
        <div className="mt-5 grid gap-2.5 text-[0.9rem] leading-6 text-muted-foreground md:grid-cols-3">
          <p>• DVI: instability from dispersion, concentration shifts, and anomaly clustering.</p>
          <p>• Regime: Stable, Elevated, Consolidating, Fragmenting, Turbulent with hysteresis + confidence.</p>
          <p>• Immutable runs: run-scoped artifacts with manifest SHA256 integrity proofs.</p>
        </div>
        <div className="mt-4 grid gap-2 text-[0.82rem] text-muted-foreground md:grid-cols-3">
          <p><span className="text-foreground">Analysts:</span> monitor structure, concentration, and volatility.</p>
          <p><span className="text-foreground">Operators:</span> alert on regime changes, anomalies, and concentration shifts.</p>
          <p><span className="text-foreground">Builders:</span> consume immutable artifacts via JSON/MCP.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <TrackedLink
            href="#live-zone"
            label="hero_live_zone"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            View Live Zone
          </TrackedLink>
          <TrackedLink
            href="/methodology#operational-guarantees"
            label="hero_methodology"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Read Methodology
          </TrackedLink>
          <TrackedLink
            href="/for-teams"
            label="hero_for_teams"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            For teams
          </TrackedLink>
          <TrackedLink
            href="/for-teams/workflows"
            label="hero_workflow_runbooks"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Workflow runbooks
          </TrackedLink>
          <TrackedLink
            href="/mcp/live"
            label="hero_mcp_live_usage"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            MCP live usage
          </TrackedLink>
          <TrackedLink
            href="/stats"
            label="hero_public_stats_html"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Public stats
          </TrackedLink>
          <TrackedLink
            href="/stats.json"
            label="hero_public_stats_json"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Stats JSON
          </TrackedLink>
          <TrackedLink
            href="/ops"
            label="hero_ops_scoreboard"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Ops scoreboard
          </TrackedLink>
          <TrackedLink
            href="/rootfetch/artifacts/latest.json"
            label="hero_fetch_latest_artifact"
            pageType="home"
            eventName="rf_open_json_api"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Fetch Latest Artifact
          </TrackedLink>
          <TrackedLink
            href="/docs/mcp"
            label="hero_connect_mcp"
            pageType="home"
            eventName="rf_mcp_doc_open"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Connect via MCP
          </TrackedLink>
          <TrackedLink
            href="/agents"
            label="hero_agent_integration"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Agent integration
          </TrackedLink>
          <TrackedLink
            href="/runs"
            label="hero_browse_runs"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Browse historical runs →
          </TrackedLink>
          <TrackedLink
            href="/tlds"
            label="hero_browse_tlds"
            pageType="home"
            className="rounded-full border border-border/70 px-3.5 py-2 text-[0.78rem] hover:border-primary/50"
          >
            Browse TLD index →
          </TrackedLink>
        </div>
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Public counters</p>
            <h2 className="font-display text-[1.35rem] font-semibold leading-[1.2] md:text-[1.6rem]">
              External observability
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <TrackedLink href="/stats" label="counter_strip_stats_html" pageType="home" className="rounded-full border border-border/70 px-2.5 py-1 hover:border-primary/50">
              /stats
            </TrackedLink>
            <TrackedLink href="/stats.json" label="counter_strip_stats_json" pageType="home" className="rounded-full border border-border/70 px-2.5 py-1 hover:border-primary/50">
              /stats.json
            </TrackedLink>
            <TrackedLink href="/mcp/live" label="counter_strip_mcp_live" pageType="home" className="rounded-full border border-border/70 px-2.5 py-1 hover:border-primary/50">
              /mcp/live
            </TrackedLink>
            <TrackedLink href="/ops" label="counter_strip_ops" pageType="home" className="rounded-full border border-border/70 px-2.5 py-1 hover:border-primary/50">
              /ops
            </TrackedLink>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Unique callers (7d / 30d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">
              {fmtInt(publicStats.unique_callers_7d)} / {fmtInt(publicStats.unique_callers_30d)}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">MCP calls (7d / 30d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">
              {fmtInt(publicStats.mcp_calls_7d)} / {fmtInt(publicStats.mcp_calls_30d)}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Tool-call success (7d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{publicStats.tool_call_success_pct.toFixed(2)}%</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Last successful run</p>
            <p className="mt-1 rf-mono-digits text-xs font-semibold">
              {publicStats.last_run_ts || "n/a"}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Snapshot freshness</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{publicStats.snapshot_freshness_label}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cross-project stats:{" "}
          <a href="https://a2abench-api.web.app/stats" className="text-primary hover:text-primary/80">
            A2ABench
          </a>{" "}
          ·{" "}
          <a href="https://ragmap-api.web.app/stats" className="text-primary hover:text-primary/80">
            Ragmap
          </a>
        </p>
      </section>

      <section className="rf-glass rounded-3xl p-5 md:p-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Public structural brief</p>
            <h2 className="font-display text-[1.7rem] font-semibold leading-[1.15] md:text-[2rem]">Current state at a glance</h2>
          </div>
          <TrackedLink
            href={compareLatestHref}
            label="public_brief_compare"
            pageType="home"
            className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50"
          >
            Compare latest
          </TrackedLink>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Regime</p>
            <p className="mt-1 font-display text-2xl font-semibold uppercase leading-none">{state}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">DVI (live run)</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold leading-none">{dviScore.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Top 10 share</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold leading-none">{top10SharePct.toFixed(2)}%</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Observed vs tracked</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold leading-none">
              {fmtInt(countedEver)} / {fmtInt(approved)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-[0.98rem] leading-7 text-muted-foreground">
          In the latest immutable run, delegated counts moved{" "}
          <span className="rf-mono-digits text-foreground">{fmtSignedInt(delta7dAbs)}</span> over 7 days with{" "}
          <span className="rf-mono-digits text-foreground">{fmtPct(delta7dPct)}</span> change, while structure remains{" "}
          <span className="font-semibold uppercase text-foreground">{state}</span>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          DVI labels: <span className="text-foreground">DVI (live run)</span> in this brief and{" "}
          <span className="text-foreground">DVI (replay window)</span> in structural analysis below.
        </p>
      </section>

      <ReplayTimelineProvider initialDays={0}>
        <div id="live-zone">
          <LiveIntelligenceZoneClient
            dateUtc={latest.date_utc}
            runId={activeRunId}
            approved={approved}
            observedToday={observedToday}
            totalDelegated={totalDelegated}
            deltaTodayAbs={deltaTodayAbs}
            delta7dAbs={delta7dAbs}
            delta7dPct={delta7dPct}
            pulseSeries={pulseSeries as Array<{ date_utc: string; total_delegated_count: number }>}
            dvi={dvi}
            top10SharePct={top10SharePct}
            marketRisk={marketRisk}
            distributionP50={asNumber(distribution.p50)}
            approvalsAddedCount={asNumber(approvalsDiff.added_count)}
            approvalsAddedPreview={approvalsAdded}
            anomalyRows={anomalyRows}
            marketMapRows={marketMapRows}
          />
        </div>

        <section className="rounded-2xl border border-cyan-300/25 bg-cyan-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Methodology &amp; Guarantees (v1)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Deterministic model + immutable artifacts + run-anchored rendering.
              </p>
            </div>
            <TrackedLink
              href="/methodology#operational-guarantees"
              label="open_methodology_guarantees"
              pageType="home"
              className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50"
            >
              Open methodology
            </TrackedLink>
          </div>
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
            <p className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <span className="text-muted-foreground">Model</span>
              <span className="rf-mono-digits">{modelVersion}</span>
            </p>
            <p className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <span className="shrink-0 text-muted-foreground">Artifact run</span>
              <span className="rf-mono-digits min-w-0 flex-1 break-all text-right leading-tight" title={activeRunId}>
                {activeRunId}
              </span>
              <span className="shrink-0">
                <CopyValueButton value={activeRunId} keyName="artifact_run_id" context="guarantees_panel" />
              </span>
            </p>
            <p className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <span className="text-muted-foreground">Manifest</span>
              <TrackedLink
                href={manifestHref}
                label="open_manifest_json"
                pageType="home"
                eventName="rf_open_json_api"
                className="text-primary hover:text-primary/80"
              >
                {manifestVerified ? "verified (sha256)" : "unverified"}
              </TrackedLink>
            </p>
            <p className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <span className="text-muted-foreground">Delivery</span>
              <span>at-least-once + dedup</span>
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-background/45 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Copy structural citation</p>
            <pre className="mt-2 max-w-full overflow-auto rounded border border-border/60 bg-background/60 p-2 text-[11px] rf-mono-digits">
              {latestCitationSnippet}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyValueButton value={latestCitationSnippet} keyName="home_structural_citation" context="guarantees_panel" />
              <TrackedLink
                href={compareLatestHref}
                label="home_open_compare_latest"
                pageType="home"
                className="inline-flex items-center rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50"
              >
                open compare
              </TrackedLink>
            </div>
          </div>
        </section>

        <details className="rounded-3xl border border-border/70 bg-card/35 p-5 md:p-6">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Operator view</p>
                <h2 className="font-display text-2xl font-semibold">Structural lab and deep analytics</h2>
              </div>
              <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                Expand
              </span>
            </div>
          </summary>
          <div className="mt-5 space-y-6">
            <StructuralAnalysisLayer marketMapRows={marketMapRows} powerCurve={powerCurve} radarRows={radarRows} />

            <AdvancedAnalyticsLayer
              marketRows={marketMapRows}
              radarRows={radarRows}
              sectorRows={sectorIndices}
              baseDviScore={dviScore}
              baseTop10SharePct={top10SharePct}
              totalDelegated={totalDelegated}
              delta7dAbs={delta7dAbs}
            />

            <section className="rf-glass rounded-3xl p-5 md:p-6">
              <div className="mb-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sector indices</p>
                <h2 className="font-display text-2xl font-semibold">Namespace market baskets</h2>
              </div>
              <SectorIndexGrid rows={sectorIndices} />
            </section>
          </div>
        </details>
      </ReplayTimelineProvider>

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <Shield className="h-3.5 w-3.5 text-emerald-300" /> Data provenance & integrity
            </p>
            <h2 className="font-display text-2xl font-semibold">DATA INTEGRITY &amp; PROVENANCE</h2>
          </div>
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-emerald-200">
            Immutable artifact badge
          </span>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <div className="min-w-0 space-y-3">
            <div className="overflow-hidden rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Snapshot hash</p>
              <div className="mt-2 flex items-start gap-2">
                <p className="rf-mono-digits min-w-0 flex-1 break-all [overflow-wrap:anywhere] text-sm font-semibold leading-tight md:text-base">{snapshotHash}</p>
                <span className="shrink-0">
                  <CopyValueButton value={snapshotHash} keyName="snapshot_hash" context="security_panel" />
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/45 p-3 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-muted-foreground">Timestamp</span>
                <span className="rf-mono-digits">{String(securityStatus.checked_at_utc || "n/a")}</span>
              </p>
              <p className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Run ID</span>
                <span className="rf-mono-digits min-w-0 max-w-[65%] break-all text-right text-xs [overflow-wrap:anywhere]">
                  {latest.run_id || "n/a"}
                </span>
              </p>
              <p className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Last artifact commit</span>
                <span className="rf-mono-digits text-xs">{lastSnapshotAgo}</span>
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Commit chain</p>
              <div className="mt-2 flex items-center gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <span
                    key={idx}
                    className={`h-2.5 w-2.5 rounded-full ${idx < 5 ? "bg-emerald-300/80" : "bg-border"}`}
                  />
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Artifact signature verified</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/45 p-3 text-sm">
              <p className="mb-1 text-muted-foreground">Security checks</p>
              <ul className="space-y-1">
                <li>
                  • Raw zone payloads excluded from public artifacts:{" "}
                  {Boolean(securityStatus.no_raw_zones_tracked) ? "yes" : "no"}
                </li>
                <li>
                  • Environment secrets excluded from tracked artifacts:{" "}
                  {Boolean(securityStatus.no_env_tracked) ? "yes" : "no"}
                </li>
                <li>
                  • Artifact serving runtime set read-only:{" "}
                  {Boolean(securityStatus.runtime_read_only) ? "yes" : "no"}
                </li>
                <li>• Manifest SHA256 coverage across files: {manifestVerified ? "yes" : "no"}</li>
              </ul>
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Coverage status</p>
              <p className="mt-1 rf-mono-digits text-lg font-semibold">
                {fmtInt(countedEver)} / {fmtInt(approved)} ({fmtPct(coveragePct)})
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/50">
                <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${Math.max(3, Math.min(100, coveragePct * 100))}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Not yet observed: {fmtInt(missingEver)}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rolling cadence indicator</p>
              <div className="mt-2 flex items-center gap-1.5">
                {[...Array(10)].map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-2 w-2 rounded-full ${idx < Math.min(10, Math.max(1, Math.round((observedToday / Math.max(1, approved)) * 10))) ? "bg-primary/80" : "bg-border/80"}`}
                  />
                ))}
              </div>
              <div className="mt-2 grid gap-2 text-xs">
                <p className="flex items-center justify-between"><span>Observed today</span><span className="rf-mono-digits">{fmtInt(observedToday)}</span></p>
                <p className="flex items-center justify-between"><span>Core</span><span className="rf-mono-digits">{fmtInt(coreToday)}</span></p>
                <p className="flex items-center justify-between"><span>Rolling</span><span className="rf-mono-digits">{fmtInt(rollingToday)}</span></p>
                <p className="flex items-center justify-between"><span>Snapshot rows</span><span className="rf-mono-digits">{fmtInt(snapshotRowsToday)}</span></p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <details className="rounded-3xl border border-border/70 bg-card/35 p-5 md:p-6">
        <summary className="cursor-pointer list-none">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <TerminalSquare className="h-3.5 w-3.5 text-primary" /> Operator feeds and command console
              </p>
              <h2 className="font-display text-2xl font-semibold">Agent and MCP operations</h2>
            </div>
            <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <section className="rf-glass rounded-3xl p-5 md:p-6">
            <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
              <div className="min-w-0 space-y-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Live artifact preview</p>
                <JsonArtifactPreview
                  payload={{
                    date_utc: latest.date_utc,
                    approved_tlds_count: approved,
                    counted_today_count: observedToday,
                    snapshot_rows_today: snapshotRowsToday,
                    total_delegated_counted_today: totalDelegated,
                    top10_share_pct: top10SharePct,
                    dvi_score: dviScore,
                    market_state: state,
                  }}
                />
              </div>
              <div className="min-w-0 space-y-3">
                <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Command console</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <TrackedLink href="/docs/mcp" label="cmd_mcp" pageType="home" eventName="rf_mcp_doc_open" className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      <Bot className="h-4 w-4" /> Copy MCP
                    </TrackedLink>
                    <TrackedLink href="/api/latest" label="cmd_fetch_artifact" pageType="home" eventName="rf_open_json_api" className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      <Database className="h-4 w-4" /> Fetch artifact
                    </TrackedLink>
                    <TrackedLink href="/api/latest" label="cmd_stream_anomaly" pageType="home" eventName="rf_rag_search" eventParams={{ q_len: 13, hits_count: anomalyRows.length }} className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      <Activity className="h-4 w-4" /> Stream anomalies
                    </TrackedLink>
                    <TrackedLink href="/ask" label="cmd_simulation" pageType="home" eventName="rf_ask_submit" eventParams={{ q_len: 24 }} className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      <TerminalSquare className="h-4 w-4" /> Run simulation
                    </TrackedLink>
                    <TrackedLink href="/tlds" label="cmd_tld_index" pageType="home" className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      <FolderTree className="h-4 w-4" /> Open TLD index
                    </TrackedLink>
                  </div>
                  <pre className="mt-3 max-w-full overflow-auto rounded-lg border border-border/70 bg-black/55 p-3 font-mono text-xs text-emerald-300">
{`$ rootfetch status
snapshot_date=${latest.date_utc}
universe_tracked=${approved}
observed_today=${observedToday}
state=${state}
`}
                  </pre>
                </div>
                <McpSnippet siteUrl={process.env.NEXT_PUBLIC_SITE_URL} />
              </div>
            </div>
          </section>

          <section className="rf-glass rounded-3xl p-5 md:p-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Daily intelligence digest</p>
              <TrackedLink href="/rootfetch/latest.md" label="open_digest_bottom" pageType="home" eventName="rf_open_digest" extraEventNames={["rf_read_digest"]} className="text-sm text-primary hover:text-primary/80">
                Open full digest
              </TrackedLink>
            </div>
            <pre className="max-h-[300px] max-w-full overflow-auto rounded-xl border border-border/70 bg-background/55 p-4 font-mono text-xs leading-relaxed">
              {digestSnippet}
            </pre>
          </section>
        </div>
      </details>

      <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-muted-foreground">
        <p>RootFetch is a read-only intelligence layer. If it is not in the artifacts, it did not happen.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/about" className="hover:text-foreground">
            about
          </Link>
          <Link href="/methodology" className="hover:text-foreground">
            methodology
          </Link>
          <Link href="/security" className="hover:text-foreground">
            security
          </Link>
          <Link href="/for-teams" className="hover:text-foreground">
            for teams
          </Link>
          <Link href="/recipes" className="hover:text-foreground">
            recipes
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            agents
          </Link>
          <Link href="/docs/integrations" className="hover:text-foreground">
            integrations
          </Link>
          <Link href="/ops" className="hover:text-foreground">
            ops
          </Link>
          <Link href="/llms.txt" className="hover:text-foreground">
            llms.txt
          </Link>
        </div>
      </footer>
    </main>
  );
}
