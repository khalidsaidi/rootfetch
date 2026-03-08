import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import CopyValueButton from "@/components/CopyValueButton";
import EmptyState from "@/components/EmptyState";
import Section from "@/components/Section";
import {
  loadPublishedRunBundle,
  loadReplayIndex,
  loadRunBundleById,
  loadRunCompareBundleById,
} from "@/lib/rootfetch-data";

type TldSnapshotRow = {
  tld: string;
  count: number;
  sharePct: number;
  deltaAbs: number | null;
  deltaPct: number | null;
  delta7dPct: number | null;
  delta30dPct: number | null;
  anomalyScore: number | null;
  volatility: number | null;
  sector: string;
  cadence: string;
};

type SignificantRun = {
  runId: string;
  snapshotTsUtc: string;
  compareHref: string | null;
  trigger: string;
  deltaAbs: number | null;
  deltaPct: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPctFromFraction(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtPctFromPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function fmtSignedInt(value: number): string {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${fmtInt(Math.abs(value))}`;
}

function extractLatestRows(signalsRaw: unknown): TldSnapshotRow[] {
  const signals = asRecord(signalsRaw);
  const marketMap = Array.isArray(signals.market_map) ? (signals.market_map as Array<Record<string, unknown>>) : [];

  if (marketMap.length > 0) {
    return marketMap
      .map((row) => ({
        tld: asString(row.tld, "").toLowerCase(),
        count: asNumber(row.count),
        sharePct: asNumber(row.share_pct),
        deltaAbs: asOptionalNumber(row.delta_abs),
        deltaPct: asOptionalNumber(row.delta_pct),
        delta7dPct: asOptionalNumber(row.delta_7d_pct),
        delta30dPct: asOptionalNumber(row.delta_30d_pct),
        anomalyScore: asOptionalNumber(row.anomaly_score),
        volatility: asOptionalNumber(row.volatility),
        sector: asString(row.sector, "other").toLowerCase(),
        cadence: asString(row.cadence, "unknown"),
      }))
      .filter((row) => row.tld.length > 0);
  }

  const topTlds = Array.isArray(signals.top_tlds) ? (signals.top_tlds as Array<Record<string, unknown>>) : [];
  return topTlds
    .map((row) => ({
      tld: asString(row.tld, "").toLowerCase(),
      count: asNumber(row.count),
      sharePct: asNumber(row.share_pct),
      deltaAbs: null,
      deltaPct: null,
      delta7dPct: null,
      delta30dPct: null,
      anomalyScore: null,
      volatility: null,
      sector: asString(row.sector, "other").toLowerCase(),
      cadence: asString(row.cadence, "unknown"),
    }))
    .filter((row) => row.tld.length > 0);
}

function normalizeReplayRuns(replayRaw: unknown): Array<{ runId: string; snapshotTsUtc: string }> {
  const runs = Array.isArray(replayRaw) ? (replayRaw as Array<Record<string, unknown>>) : [];
  return runs
    .map((row) => ({
      runId: asString(row.run_id),
      snapshotTsUtc: asString(row.snapshot_ts_utc),
    }))
    .filter((row) => row.runId.length > 0)
    .sort((left, right) => left.snapshotTsUtc.localeCompare(right.snapshotTsUtc));
}

function containsTldInMovers(signalsRaw: unknown, tld: string): { matched: boolean; deltaAbs: number | null; deltaPct: number | null } {
  const signals = asRecord(signalsRaw);
  const topMovers = Array.isArray(signals.top_movers_abs) ? (signals.top_movers_abs as Array<Record<string, unknown>>) : [];
  const coreMovers = Array.isArray(signals.core_movers_abs) ? (signals.core_movers_abs as Array<Record<string, unknown>>) : [];
  const movers = topMovers.length > 0 ? topMovers : coreMovers;
  const hit = movers.find((row) => asString(row.tld).toLowerCase() === tld);
  if (!hit) {
    return { matched: false, deltaAbs: null, deltaPct: null };
  }
  return {
    matched: true,
    deltaAbs: asOptionalNumber(hit.delta_abs),
    deltaPct: asOptionalNumber(hit.delta_pct),
  };
}

function containsTldInAnomalies(signalsRaw: unknown, tld: string): boolean {
  const signals = asRecord(signalsRaw);
  const anomalies = Array.isArray(signals.anomalies) ? (signals.anomalies as Array<Record<string, unknown>>) : [];
  return anomalies.some((row) => asString(row.tld).toLowerCase() === tld);
}

async function loadSignificantRuns(
  tld: string,
  activeRunId: string,
  previousRunId: string | null,
): Promise<SignificantRun[]> {
  const results: SignificantRun[] = [];

  const activeRun = await loadRunCompareBundleById(activeRunId);
  if (activeRun) {
    const mover = containsTldInMovers(activeRun.signals, tld);
    const anomaly = containsTldInAnomalies(activeRun.signals, tld);
    if (mover.matched || anomaly) {
      results.push({
        runId: activeRunId,
        snapshotTsUtc: asString(activeRun.manifest.snapshot_ts_utc || activeRun.signals.date_utc, "n/a"),
        compareHref: previousRunId
          ? `/compare?left=${encodeURIComponent(previousRunId)}&right=${encodeURIComponent(activeRunId)}`
          : null,
        trigger: anomaly ? "anomaly_or_mover" : "mover",
        deltaAbs: mover.deltaAbs,
        deltaPct: mover.deltaPct,
      });
    }
  }

  if (previousRunId) {
    const previousRun = await loadRunCompareBundleById(previousRunId);
    if (previousRun) {
      const mover = containsTldInMovers(previousRun.signals, tld);
      const anomaly = containsTldInAnomalies(previousRun.signals, tld);
      if (mover.matched || anomaly) {
        results.push({
          runId: previousRunId,
          snapshotTsUtc: asString(previousRun.manifest.snapshot_ts_utc || previousRun.signals.date_utc, "n/a"),
          compareHref: null,
          trigger: anomaly ? "anomaly_or_mover" : "mover",
          deltaAbs: mover.deltaAbs,
          deltaPct: mover.deltaPct,
        });
      }
    }
  }

  return results;
}

export async function generateMetadata({ params }: { params: Promise<{ tld: string }> }): Promise<Metadata> {
  const { tld: raw } = await params;
  const tld = raw.toLowerCase();

  if (!/^[a-z0-9-]+$/.test(tld)) {
    return {
      title: `.${tld} Not Found`,
      description: `No artifact-derived metrics found for .${tld}.`,
      alternates: {
        canonical: `/tld/${tld}`,
      },
    };
  }

  const published = await loadPublishedRunBundle();
  if (!published) {
    return {
      title: `.${tld} Structural Metrics`,
      description: `Artifact-derived structural metrics for .${tld}.`,
      alternates: {
        canonical: `/tld/${tld}`,
      },
    };
  }

  const activeRunId = asString(published.pointer.run_id || published.signals.run_id, asString(published.signals.run_id, ""));
  const run = activeRunId ? await loadRunBundleById(activeRunId) : null;
  const signals = run?.signals ?? published.signals;
  const rows = extractLatestRows(signals);
  const latest = rows.find((row) => row.tld === tld);

  return {
    title: `.${tld} Structural Metrics`,
    description: latest
      ? `Run-anchored metrics for .${tld}: delegated ${latest.count.toLocaleString("en-US")}, share ${latest.sharePct.toFixed(2)}%.`
      : `No artifact-derived metrics found for .${tld}.`,
    alternates: {
      canonical: `/tld/${tld}`,
    },
  };
}

export async function generateStaticParams(): Promise<Array<{ tld: string }>> {
  const published = await loadPublishedRunBundle();
  if (!published) {
    return [];
  }
  const activeRunId = asString(published.pointer.run_id || published.signals.run_id, asString(published.signals.run_id, ""));
  const run = activeRunId ? await loadRunBundleById(activeRunId) : null;
  const signals = run?.signals ?? published.signals;
  const rows = extractLatestRows(signals);
  return Array.from(new Set(rows.map((row) => row.tld))).map((tld) => ({ tld }));
}

export default async function TldPage({ params }: { params: Promise<{ tld: string }> }) {
  const { tld: raw } = await params;
  const tld = raw.toLowerCase();

  if (!/^[a-z0-9-]+$/.test(tld)) {
    notFound();
  }

  const published = await loadPublishedRunBundle();
  if (!published) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
        <EmptyState
          title={`.${tld} unavailable`}
          description="No immutable published run is currently available."
        />
      </main>
    );
  }

  const activeRunId = asString(published.pointer.run_id || published.signals.run_id, asString(published.signals.run_id, ""));
  const run = activeRunId ? await loadRunBundleById(activeRunId) : null;
  const signals = run?.signals ?? published.signals;
  const rows = extractLatestRows(signals);
  const row = rows.find((item) => item.tld === tld);
  if (!row) {
    notFound();
  }

  const replay = await loadReplayIndex();
  const normalizedReplay = normalizeReplayRuns((replay as { runs?: unknown }).runs);
  const activeIdx = normalizedReplay.findIndex((item) => item.runId === activeRunId);
  const previousRunId = activeIdx > 0 ? normalizedReplay[activeIdx - 1]?.runId || null : null;

  const significantRuns = await loadSignificantRuns(tld, activeRunId, previousRunId);

  const manifest = asRecord(run?.manifest);
  const snapshotTsUtc = asString(manifest.snapshot_ts_utc || signals.date_utc, "n/a");
  const manifestSha = asString(run?.manifestSha256, "n/a");
  const model = asRecord(run?.model);
  const modelVersion = asString(model.model_version || manifest.model_version, asString(published.pointer.model_version, "n/a"));
  const methodologyVersion = asString(model.methodology_version || published.pointer.methodology_version, "n/a");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";
  const canonicalUrl = `${siteUrl}/tld/${encodeURIComponent(tld)}`;
  const runUrl = `${siteUrl}/runs/${encodeURIComponent(activeRunId)}`;
  const baseHref = run?.baseHref || `/rootfetch/artifacts/runs/${encodeURIComponent(activeRunId)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `RootFetch TLD Structural Metrics (.${tld})`,
    description: `Run-anchored artifact-derived metrics for .${tld}.`,
    url: canonicalUrl,
    identifier: activeRunId,
    dateModified: snapshotTsUtc,
    isBasedOn: runUrl,
    variableMeasured: [
      "delegated_count",
      "share_pct",
      "delta_abs",
      "delta_pct",
      "delta_7d_pct",
      "delta_30d_pct",
      "anomaly_score",
    ],
    distribution: [
      { "@type": "DataDownload", contentUrl: `${siteUrl}${baseHref}/signals_latest.json`, encodingFormat: "application/json" },
      { "@type": "DataDownload", contentUrl: `${siteUrl}${baseHref}/coverage_latest.json`, encodingFormat: "application/json" },
      { "@type": "DataDownload", contentUrl: `${siteUrl}${baseHref}/model_latest.json`, encodingFormat: "application/json" },
      { "@type": "DataDownload", contentUrl: `${siteUrl}${baseHref}/manifest.json`, encodingFormat: "application/json" },
    ],
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Section title={`.${tld}`} subtitle="Run-scoped structural metrics derived from immutable artifacts." className="rf-glass">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Run ID</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold leading-tight break-all [overflow-wrap:anywhere]">{activeRunId}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Snapshot UTC</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{snapshotTsUtc}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Model</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{modelVersion}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Manifest SHA256</p>
            <p className="mt-1 rf-mono-digits text-xs font-semibold leading-tight break-all [overflow-wrap:anywhere]">{manifestSha}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <CopyValueButton value={activeRunId} keyName="tld_run_id" context="tld_page_header" />
          <CopyValueButton value={manifestSha} keyName="tld_manifest_sha" context="tld_page_header" />
          <Link href={`/runs/${encodeURIComponent(activeRunId)}`} className="rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            run evidence
          </Link>
          {previousRunId ? (
            <Link
              href={`/compare?left=${encodeURIComponent(previousRunId)}&right=${encodeURIComponent(activeRunId)}`}
              className="rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
            >
              compare previous
            </Link>
          ) : null}
          <Link href="/tlds" className="rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            all tlds
          </Link>
        </div>
      </Section>

      <Section title="Latest Metrics" subtitle="Latest delegated count, share, and deltas (if present in latest run artifact).">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Delegated count</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold">{fmtInt(row.count)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Share</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold">{fmtPctFromPercent(row.sharePct)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ latest</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold">{row.deltaAbs === null ? "n/a" : fmtSignedInt(row.deltaAbs)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ latest %</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold">{row.deltaPct === null ? "n/a" : fmtPctFromFraction(row.deltaPct)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ 7d %</p>
            <p className="mt-1 rf-mono-digits text-lg font-semibold">{row.delta7dPct === null ? "n/a" : fmtPctFromFraction(row.delta7dPct)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ 30d %</p>
            <p className="mt-1 rf-mono-digits text-lg font-semibold">{row.delta30dPct === null ? "n/a" : fmtPctFromFraction(row.delta30dPct)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Anomaly score</p>
            <p className="mt-1 rf-mono-digits text-lg font-semibold">{row.anomalyScore === null ? "n/a" : row.anomalyScore.toFixed(3)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Sector / cadence</p>
            <p className="mt-1 rf-mono-digits text-lg font-semibold">{row.sector} / {row.cadence || "n/a"}</p>
          </div>
        </div>
      </Section>

      <Section title="Significant Change Evidence" subtitle="Runs where this TLD appears in movers/anomalies for active/prior run window.">
        {significantRuns.length === 0 ? (
          <EmptyState
            title="No significant-change entries in active/prior run window"
            description="No top_movers/anomalies match for this TLD in current evidence window."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full text-sm">
              <thead className="bg-background/70 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Run</th>
                  <th className="px-3 py-2 text-left">Snapshot UTC</th>
                  <th className="px-3 py-2 text-left">Trigger</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                  <th className="px-3 py-2 text-right">Δ%</th>
                  <th className="px-3 py-2 text-left">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {significantRuns.map((item) => (
                  <tr key={item.runId}>
                    <td className="px-3 py-2 rf-mono-digits">{item.runId}</td>
                    <td className="px-3 py-2 rf-mono-digits">{item.snapshotTsUtc}</td>
                    <td className="px-3 py-2 rf-mono-digits">{item.trigger}</td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{item.deltaAbs === null ? "n/a" : fmtSignedInt(item.deltaAbs)}</td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{item.deltaPct === null ? "n/a" : fmtPctFromFraction(item.deltaPct)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/runs/${encodeURIComponent(item.runId)}`} className="text-cyan-200 hover:text-cyan-100">
                          run
                        </Link>
                        {item.compareHref ? (
                          <Link href={item.compareHref} className="text-cyan-200 hover:text-cyan-100">
                            compare
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Evidence Files" subtitle="Artifact links for this run/tld context.">
        <div className="flex flex-wrap gap-2 text-xs">
          <a href={`${baseHref}/manifest.json`} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            manifest.json <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href={`${baseHref}/signals_latest.json`} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            signals_latest.json <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href={`${baseHref}/coverage_latest.json`} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            coverage_latest.json <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href={`${baseHref}/model_latest.json`} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
            model_latest.json <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span className="inline-flex items-center rounded-lg border border-border/70 px-2.5 py-1.5 rf-mono-digits">
            methodology {methodologyVersion}
          </span>
        </div>
      </Section>
    </main>
  );
}
