import Link from "next/link";

import CadenceLegend from "@/components/CadenceLegend";
import EmptyState from "@/components/EmptyState";
import InsightBanner from "@/components/InsightBanner";
import Section from "@/components/Section";
import SecurityStatusCard from "@/components/SecurityStatusCard";
import SnapshotExplainer from "@/components/SnapshotExplainer";
import DownloadLinkButton from "@/components/DownloadLinkButton";
import McpSnippet from "@/components/McpSnippet";
import NewApprovalsPanel from "@/components/NewApprovalsPanel";
import StatCard from "@/components/StatCard";
import ThemeToggle from "@/components/ThemeToggle";
import TopTldTableClient from "@/components/TopTldTableClient";
import DistributionBars from "@/components/charts/DistributionBars";
import TrackedLink from "@/components/TrackedLink";
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

function toSigned(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  const rounded = Math.trunc(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US").format(rounded)}`;
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
    loadDigestSnippet(22),
  ]);

  const approved = coverage.approved_tlds_count || latest.approved_tlds_count || 0;
  const observedToday = latest.counted_today_count ?? 0;
  const coreToday = latest.counted_today_core_count ?? coverage.counted_today_core_count ?? 0;
  const rollingToday = latest.counted_today_rolling_count ?? coverage.counted_today_rolling_count ?? 0;
  const snapshotRowsToday =
    latest.snapshot_rows_today ?? latest.processed_tlds_count_today ?? coverage.counted_today_count ?? 0;
  const countedEver = coverage.counted_ever_count ?? 0;
  const missingEver = coverage.missing_ever_count ?? Math.max(0, approved - countedEver);
  const coveragePct = approved > 0 ? observedToday / approved : 0;

  const topRows = latest.top_tlds && latest.top_tlds.length > 0 ? latest.top_tlds : topCsv;

  const distribution = {
    ...distributionFallback,
    ...(latest.distribution || {}),
  } as Record<string, number>;

  const concentration = {
    ...concentrationFallback,
    ...(latest.concentration || {}),
  } as Record<string, number>;

  const approvalsDiff = {
    ...approvalsFallback,
    ...(latest.approvals_diff || {}),
  } as Record<string, unknown>;

  const securityStatus = {
    ...securityFallback,
    ...(latest.security_status || {}),
  } as Record<string, unknown>;

  const insights = Array.isArray(latest.insights)
    ? latest.insights.filter((item) => item && typeof item.text === "string" && item.text.trim())
    : [];

  const tiny = Number(distribution.tiny_tlds_lt_100 || distribution.tiny_lt_100 || 0);
  const small = Number(distribution.small_tlds_lt_1000 || distribution.small_lt_1000 || 0);
  const medium = Math.max(snapshotRowsToday - small, 0);
  const totalDelegated = Number(latest.total_delegated_counted_today || latest.total_delegated_domains_today || 0);

  const distributionBars = [
    { bucket: "tiny <100", count: tiny },
    { bucket: "small <1k", count: Math.max(small - tiny, 0) },
    { bucket: "1k+", count: medium },
  ];

  const jsonLdSoftware = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "RootFetch",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app",
    description:
      "Read-only analytics dashboard for CZDS-approved TLD delegation counts, movers, concentration, and coverage.",
  };

  const jsonLdDataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "RootFetch Delegation Snapshot",
    description: "Daily delegated-domain counts per approved TLD derived from local CZDS ingestion.",
    creator: {
      "@type": "Organization",
      name: "RootFetch",
    },
    distribution: [
      {
        "@type": "DataDownload",
        contentUrl: "/rootfetch/latest.json",
        encodingFormat: "application/json",
      },
      {
        "@type": "DataDownload",
        contentUrl: "/rootfetch/top_tlds_latest.csv",
        encodingFormat: "text/csv",
      },
    ],
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-16 pt-8 md:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSoftware) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdDataset) }} />

      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/80 p-6 shadow-glow md:p-8">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-28 w-28 rounded-full bg-accent/20 blur-3xl" />

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">RootFetch Delegation Intelligence</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Delegation intelligence from DNS-visible evidence, not marketing claims
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground md:text-base">
              RootFetch ingests CZDS snapshots locally, computes safe aggregates, and publishes read-only artifacts to Vercel.
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
          <TrackedLink
            href="/approved"
            label="open_approved"
            pageType="home"
            eventName="rf_open_approved"
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            Approved TLDs
          </TrackedLink>
          <TrackedLink
            href="/sectors"
            label="open_sectors"
            pageType="home"
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            Sectors
          </TrackedLink>
          <TrackedLink
            href="/compare"
            label="open_compare"
            pageType="home"
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            Compare TLDs
          </TrackedLink>
          <TrackedLink
            href="/ask"
            label="open_ask"
            pageType="home"
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            Ask RootFetch
          </TrackedLink>
          <TrackedLink
            href="/api/latest"
            label="open_json_api"
            pageType="home"
            eventName="rf_open_json_api"
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            JSON API
          </TrackedLink>
          <TrackedLink
            href="/rootfetch/latest.md"
            label="open_digest"
            pageType="home"
            eventName="rf_open_digest"
            extraEventNames={["rf_read_digest"]}
            className="rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-sm hover:border-primary/50"
          >
            Read Digest
          </TrackedLink>
        </div>
      </section>

      <InsightBanner insights={insights} />

      <section className="rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">Snapshot Story</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Full snapshot coverage plus observed-today freshness from core + rolling cadence.
            </p>
          </div>
          <SnapshotExplainer />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Approved TLDs" value={approved} dataTestId="stat-approved" />
          <StatCard
            label="Observed today"
            value={observedToday}
            hint={`core ${fmtInt(coreToday)} + rolling ${fmtInt(rollingToday)}`}
            tooltip="Observed today means TLDs we actually downloaded and recounted today from core + rolling cadence."
            dataTestId="stat-observed"
          />
          <StatCard
            label="Snapshot rows today"
            value={snapshotRowsToday}
            tooltip="Snapshot rows include all approved TLDs represented in the current artifact set, including carried-forward rows."
          />
          <StatCard label="Counted ever" value={countedEver} />
          <StatCard
            label="Missing ever"
            value={missingEver}
            hint={missingEver === 0 ? "coverage complete" : "baseline catch-up required"}
            dataTestId="stat-missing"
          />
        </div>
        <div className="mt-4">
          <CadenceLegend />
        </div>
      </section>

      <Section title="Market Structure" subtitle="Cross-sectional signals generated from today’s committed counts.">
        <div className="grid gap-5 lg:grid-cols-[1.6fr,1fr]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">Top TLDs by size</h3>
              <DownloadLinkButton
                href="/rootfetch/top_tlds_latest.csv"
                filename="rootfetch_top_tlds_latest.csv"
                label="Download CSV"
                kind="top_tlds"
              />
            </div>
            {topRows.length > 0 ? (
              <TopTldTableClient rows={topRows} />
            ) : (
              <EmptyState title="No top-TLD table yet" description="Run compute-signals after a local ingestion cycle to generate top-TLD rows." />
            )}
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold">Distribution</h3>
                <TrackedLink
                  href="/methodology#distribution"
                  label="distribution_explain"
                  pageType="home"
                  eventName="rf_distribution_view"
                  className="text-xs text-primary hover:text-primary/80"
                >
                  Explain this
                </TrackedLink>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatCard label="Median (p50)" value={Number(distribution.p50 || 0)} />
                <StatCard label="p90" value={Number(distribution.p90 || 0)} />
                <StatCard label="p99" value={Number(distribution.p99 || 0)} />
                <StatCard label="Tiny (<100)" value={Number(distribution.tiny_tlds_lt_100 || distribution.tiny_lt_100 || 0)} />
              </div>
              <div className="mt-3">
                <DistributionBars rows={distributionBars} />
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold">Concentration</h3>
                <TrackedLink
                  href="/methodology#concentration"
                  label="concentration_explain"
                  pageType="home"
                  eventName="rf_concentration_view"
                  className="text-xs text-primary hover:text-primary/80"
                >
                  Explain this
                </TrackedLink>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatCard label="Top 1 share" value={fmtPct(Number(concentration.top1_share_pct || 0))} />
                <StatCard label="Top 10 share" value={fmtPct(Number(concentration.top10_share_pct || 0))} dataTestId="tile-top10-share" />
                <StatCard label="Top 3 share" value={fmtPct(Number(concentration.top3_share_pct || 0))} />
                <StatCard label="HHI" value={Number(concentration.hhi || 0).toFixed(4)} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 font-display text-lg font-semibold">New approvals today</h3>
              <NewApprovalsPanel approvals={approvalsDiff} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Trend Signals" subtitle="Day-over-day movers for core cadence and since-last-seen updates for rolling cadence.">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 font-display text-base font-semibold">Core Movers</h3>
            {latest.core_movers_abs && latest.core_movers_abs.length > 0 ? (
              <ul className="space-y-2">
                {latest.core_movers_abs.slice(0, 8).map((row) => (
                  <li
                    key={`${row.tld}-${row.delta_abs}`}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm"
                  >
                    <TrackedLink
                      href={`/tld/${row.tld}`}
                      label={`core_mover_${row.tld}`}
                      pageType="home"
                      eventName="rf_core_mover_click"
                      eventParams={{ tld: row.tld }}
                      className="font-medium hover:text-primary"
                    >
                      .{row.tld}
                    </TrackedLink>
                    <div className="text-right">
                      <p className={Number(row.delta_abs || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{toSigned(row.delta_abs)}</p>
                      <p className="text-xs text-muted-foreground">{fmtRatio(row.delta_pct)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No core movers yet" description="Core movers appear once consecutive day-over-day core observations exist." />
            )}
          </div>

          <div>
            <h3 className="mb-2 font-display text-base font-semibold">Rolling Updates</h3>
            {latest.rolling_updates && latest.rolling_updates.length > 0 ? (
              <ul className="space-y-2">
                {latest.rolling_updates.slice(0, 8).map((row) => {
                  const isFirstSeen = !row.prev_date_utc;
                  return (
                    <li key={`${row.tld}-${row.prev_date_utc || "first"}`} className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <TrackedLink
                          href={`/tld/${row.tld}`}
                          label={`rolling_update_${row.tld}`}
                          pageType="home"
                          eventName="rf_rolling_update_click"
                          eventParams={{ tld: row.tld }}
                          className="font-medium hover:text-primary"
                        >
                          .{row.tld}
                        </TrackedLink>
                        <span className="text-xs text-muted-foreground">{fmtInt(row.count)}</span>
                      </div>
                      {isFirstSeen ? (
                        <p className="mt-1 text-xs text-amber-300">First seen today (baseline)</p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          since {row.prev_date_utc} • {toSigned(row.delta_abs)} • {fmtRatio(row.delta_pct)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No rolling updates yet" description="Rolling updates show change since each TLD was last observed." />
            )}
          </div>

          <div>
            <h3 className="mb-2 font-display text-base font-semibold">Sector Snapshot</h3>
            {latest.sector_snapshot && latest.sector_snapshot.length > 0 ? (
              <ul className="space-y-2">
                {latest.sector_snapshot.slice(0, 8).map((row) => (
                  <li key={row.sector} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm">
                    <TrackedLink
                      href={`/sectors`}
                      label={`sector_snapshot_${row.sector}`}
                      pageType="home"
                      eventName="rf_sector_row_click"
                      eventParams={{ sector: row.sector }}
                      className="font-medium hover:text-primary"
                    >
                      {row.sector}
                    </TrackedLink>
                    <span className="text-xs text-muted-foreground">{fmtInt(row.sector_count)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sector snapshot yet" description="Sector summaries populate after signal computation and index updates." />
            )}
          </div>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="How It Works" subtitle="RootFetch data path in plain language.">
          <ol className="space-y-3 text-sm">
            <li className="rounded-lg border border-border/70 bg-background/70 p-3">1. Discover all CZDS-approved TLDs.</li>
            <li className="rounded-lg border border-border/70 bg-background/70 p-3">
              2. Ingest locally: baseline full sweep, then daily hybrid (core + rolling).
            </li>
            <li className="rounded-lg border border-border/70 bg-background/70 p-3">
              3. Compute safe aggregates, market structure, trend signals, and digest text.
            </li>
            <li className="rounded-lg border border-border/70 bg-background/70 p-3">
              4. Commit artifacts; Vercel serves read-only `/rootfetch/*` files and APIs.
            </li>
          </ol>
        </Section>

        <Section title="Security & Data Handling" subtitle="Security and trust are explicit product features, not footnotes.">
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
          <div className="mt-3">
            <TrackedLink href="/security" label="open_security_page" pageType="home" className="text-sm text-primary hover:text-primary/80">
              Open full security page
            </TrackedLink>
          </div>
        </Section>
      </div>

      <Section title="Developer + AI-native" subtitle="Public JSON artifacts, MCP tools, and static RAG for agents.">
        <div className="grid gap-4 lg:grid-cols-[1.1fr,1fr]">
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Observed coverage:</span> {fmtRatio(coveragePct)}
            </p>
            <p>
              <span className="text-muted-foreground">Total delegated counted today:</span> {fmtInt(totalDelegated)}
            </p>
            <p>
              <span className="text-muted-foreground">Run ID:</span> <span className="font-mono text-xs">{latest.run_id}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TrackedLink href="/ask" label="open_ask_from_developer" pageType="home" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
                Ask RootFetch
              </TrackedLink>
              <TrackedLink href="/docs/mcp" label="open_mcp_docs" pageType="home" eventName="rf_mcp_doc_open" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
                MCP docs
              </TrackedLink>
              <TrackedLink href="/api/latest" label="open_latest_api_from_developer" pageType="home" eventName="rf_open_json_api" className="rounded-full border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50">
                /api/latest
              </TrackedLink>
            </div>
          </div>
          <McpSnippet siteUrl={process.env.NEXT_PUBLIC_SITE_URL} />
        </div>
      </Section>

      <Section title="Digest Preview" subtitle="Daily summary generated from committed artifacts.">
        <pre className="max-h-[420px] overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {digestSnippet}
        </pre>
        <div className="mt-3">
          <TrackedLink
            href="/rootfetch/latest.md"
            label="open_digest_bottom"
            pageType="home"
            eventName="rf_open_digest"
            extraEventNames={["rf_read_digest"]}
            className="text-sm text-primary hover:text-primary/80"
          >
            Open full digest
          </TrackedLink>
        </div>
      </Section>

      <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-xs text-muted-foreground">
        <p>RootFetch keeps ingestion local only. Vercel remains read-only.</p>
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
