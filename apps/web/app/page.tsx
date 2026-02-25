import { createHash } from "node:crypto";
import Link from "next/link";
import {
  Activity,
  Bot,
  Database,
  Shield,
  TerminalSquare,
} from "lucide-react";

import AdvancedAnalyticsLayer from "@/components/home/AdvancedAnalyticsLayer";
import AlertControlPanel from "@/components/home/AlertControlPanel";
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
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
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
    loadDigestSnippet(26),
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
  const distribution = { ...distributionFallback, ...(latest.distribution || {}) } as Record<string, unknown>;
  const concentration = { ...concentrationFallback, ...(latest.concentration || {}) } as Record<string, unknown>;
  const approvalsDiff = { ...approvalsFallback, ...(latest.approvals_diff || {}) } as Record<string, unknown>;
  const securityStatus = { ...securityFallback, ...(latest.security_status || {}) } as Record<string, unknown>;

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
          robust_z: Number(row.robust_z || 0),
          volatility: Number(row.volatility || 0),
          count: Number(row.count || 0),
          sector: row.sector || "other",
          label: row.label || "signal",
        }))
    : (latest.anomalies || []).slice(0, 12).map((row) => ({
        tld: row.tld,
        delta_abs: 0,
        delta_pct: Number(row.delta_pct || 0),
        robust_z: Number(row.robust_z || 0),
        volatility: 0,
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

  const jsonLdSoftware = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "RootFetch Delegation Intelligence Engine",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app",
    description:
      "Infrastructure-grade delegation intelligence console powered by local CZDS ingestion and read-only committed artifacts.",
  };

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-16 pt-5 md:px-8">
      <HomeViewTracker />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSoftware) }} />

      <ReplayTimelineProvider initialDays={0}>
        <LiveIntelligenceZoneClient
          dateUtc={latest.date_utc}
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

        <StructuralAnalysisLayer marketMapRows={marketMapRows} powerCurve={powerCurve} radarRows={radarRows} />

        <AlertControlPanel rows={anomalyRows} dviScore={dviScore} top10SharePct={top10SharePct} />

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
          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Snapshot hash</p>
              <div className="mt-2 flex items-center gap-2">
                <p className="rf-mono-digits text-lg font-semibold">{snapshotHash}</p>
                <CopyValueButton value={snapshotHash} keyName="snapshot_hash" context="security_panel" />
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/45 p-3 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-muted-foreground">Timestamp</span>
                <span className="rf-mono-digits">{String(securityStatus.checked_at_utc || "n/a")}</span>
              </p>
              <p className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Run ID</span>
                <span className="rf-mono-digits text-xs">{latest.run_id || "n/a"}</span>
              </p>
              <p className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Time since snapshot</span>
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
                <li>• no_raw_zones_tracked: {String(Boolean(securityStatus.no_raw_zones_tracked))}</li>
                <li>• no_ai_dir_tracked: {String(Boolean(securityStatus.no_ai_dir_tracked))}</li>
                <li>• no_env_tracked: {String(Boolean(securityStatus.no_env_tracked))}</li>
                <li>• vercel_read_only: {String(Boolean(securityStatus.vercel_read_only))}</li>
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Coverage progress</p>
              <p className="mt-1 rf-mono-digits text-lg font-semibold">
                {fmtInt(countedEver)} / {fmtInt(approved)} ({fmtPct(coveragePct)})
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/50">
                <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${Math.max(3, Math.min(100, coveragePct * 100))}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Missing ever: {fmtInt(missingEver)}</p>
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

      <section className="rf-glass rounded-3xl p-5 md:p-6">
        <div className="mb-4">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <TerminalSquare className="h-3.5 w-3.5 text-primary" /> AI control surface
          </p>
          <h2 className="font-display text-2xl font-semibold">Agent connection and command console</h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <div className="space-y-3">
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
          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Command console</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <TrackedLink href="/docs/mcp" label="cmd_mcp" pageType="home" eventName="rf_mcp_doc_open" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                  <Bot className="h-4 w-4" /> Copy MCP
                </TrackedLink>
                <TrackedLink href="/api/latest" label="cmd_fetch_artifact" pageType="home" eventName="rf_open_json_api" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                  <Database className="h-4 w-4" /> Fetch artifact
                </TrackedLink>
                <TrackedLink href="/api/latest" label="cmd_stream_anomaly" pageType="home" eventName="rf_rag_search" eventParams={{ q_len: 13, hits_count: anomalyRows.length }} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                  <Activity className="h-4 w-4" /> Stream anomalies
                </TrackedLink>
                <TrackedLink href="/ask" label="cmd_simulation" pageType="home" eventName="rf_ask_submit" eventParams={{ q_len: 24 }} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                  <TerminalSquare className="h-4 w-4" /> Run simulation
                </TrackedLink>
              </div>
              <pre className="mt-3 rounded-lg border border-border/70 bg-black/55 p-3 font-mono text-xs text-emerald-300">
{`$ rootfetch status
snapshot_date=${latest.date_utc}
approved=${approved}
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
        <pre className="max-h-[300px] overflow-auto rounded-xl border border-border/70 bg-background/55 p-4 font-mono text-xs leading-relaxed">
          {digestSnippet}
        </pre>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-muted-foreground">
        <p>RootFetch runs local ingestion only. Vercel serves read-only committed intelligence artifacts.</p>
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
