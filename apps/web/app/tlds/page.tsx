import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import CopyValueButton from "@/components/CopyValueButton";
import EmptyState from "@/components/EmptyState";
import Section from "@/components/Section";
import { loadPublishedRunBundle, loadReplayIndex, loadRunBundleById } from "@/lib/rootfetch-data";

type TldRow = {
  tld: string;
  count: number;
  sharePct: number;
  deltaAbs: number | null;
  deltaPct: number | null;
  sector: string;
  anomalyScore: number | null;
  volatility: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSignedInt(value: number): string {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${fmtInt(Math.abs(value))}`;
}

function volatilityPosition(row: TldRow): string {
  if (row.anomalyScore !== null) {
    if (row.anomalyScore >= 3.5) return "high";
    if (row.anomalyScore >= 2.0) return "elevated";
    return "normal";
  }
  if (row.deltaPct !== null) {
    const magnitude = Math.abs(row.deltaPct);
    if (magnitude >= 0.03) return "high";
    if (magnitude >= 0.01) return "elevated";
    return "normal";
  }
  return "n/a";
}

function extractRows(signalsRaw: unknown): TldRow[] {
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
        sector: asString(row.sector, "other").toLowerCase(),
        anomalyScore: asOptionalNumber(row.anomaly_score),
        volatility: asOptionalNumber(row.volatility),
      }))
      .filter((row) => row.tld.length > 0)
      .sort((left, right) => right.count - left.count || left.tld.localeCompare(right.tld));
  }

  const topTlds = Array.isArray(signals.top_tlds) ? (signals.top_tlds as Array<Record<string, unknown>>) : [];
  return topTlds
    .map((row) => ({
      tld: asString(row.tld, "").toLowerCase(),
      count: asNumber(row.count),
      sharePct: asNumber(row.share_pct),
      deltaAbs: null,
      deltaPct: null,
      sector: asString(row.sector, "other").toLowerCase(),
      anomalyScore: null,
      volatility: null,
    }))
    .filter((row) => row.tld.length > 0)
    .sort((left, right) => right.count - left.count || left.tld.localeCompare(right.tld));
}

function resolvePreviousRunId(currentRunId: string, replayRuns: Array<Record<string, unknown>>): string | null {
  const sorted = replayRuns
    .map((row) => ({
      runId: asString(row.run_id),
      snapshotTs: asString(row.snapshot_ts_utc),
    }))
    .filter((row) => row.runId.length > 0)
    .sort((left, right) => left.snapshotTs.localeCompare(right.snapshotTs));

  const currentIdx = sorted.findIndex((row) => row.runId === currentRunId);
  if (currentIdx <= 0) {
    return null;
  }
  return sorted[currentIdx - 1]?.runId || null;
}

export const metadata: Metadata = {
  title: "TLD Structural Index",
  description: "Artifact-derived TLD structural index anchored to the latest immutable RootFetch run.",
  alternates: {
    canonical: "/tlds",
  },
};

export default async function TldsPage() {
  const published = await loadPublishedRunBundle();
  if (!published) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
        <EmptyState
          title="TLD index unavailable"
          description="No immutable published run is available yet."
        />
      </main>
    );
  }

  const activeRunId = asString(published.pointer.run_id || published.signals.run_id, asString(published.signals.run_id, ""));
  const run = activeRunId ? await loadRunBundleById(activeRunId) : null;
  const signals = run?.signals ?? published.signals;
  const coverage = run?.coverage ?? published.coverage;
  const rows = extractRows(signals);
  const snapshotTsUtc = asString(run?.manifest?.snapshot_ts_utc || signals.date_utc, "n/a");
  const manifestSha = asString(run?.manifestSha256, "n/a");
  const replay = await loadReplayIndex();
  const replayRuns = Array.isArray(replay.runs) ? (replay.runs as Array<Record<string, unknown>>) : [];
  const previousRunId = resolvePreviousRunId(activeRunId, replayRuns);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section
        title="TLD Structural Index"
        subtitle="Artifact-derived listing anchored to one immutable run."
        className="rf-glass"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Active run</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{activeRunId || "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Snapshot UTC</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{snapshotTsUtc}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Approved TLDs</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(asNumber(coverage.approved_tlds_count))}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Manifest SHA256</p>
            <p className="mt-1 rf-mono-digits text-xs font-semibold">{manifestSha}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <CopyValueButton value={activeRunId} keyName="tlds_active_run_id" context="tlds_header" />
          <CopyValueButton value={manifestSha} keyName="tlds_manifest_sha" context="tlds_header" />
          <Link
            href={`/runs/${encodeURIComponent(activeRunId)}`}
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
          >
            run evidence
          </Link>
          {previousRunId ? (
            <Link
              href={`/compare?left=${encodeURIComponent(previousRunId)}&right=${encodeURIComponent(activeRunId)}`}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
            >
              compare previous
            </Link>
          ) : null}
          {run ? (
            <a
              href={`${run.baseHref}/signals_latest.json`}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
            >
              signals_latest.json <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </Section>

      {rows.length === 0 ? (
        <EmptyState title="No TLD rows available" description="Latest run does not contain market_map/top_tlds rows." />
      ) : (
        <Section title="TLDs" subtitle="Delegation count, latest delta, sector, and derived volatility position.">
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full text-sm">
              <thead className="bg-background/70 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">TLD</th>
                  <th className="px-3 py-2 text-right">Delegated</th>
                  <th className="px-3 py-2 text-right">Share</th>
                  <th className="px-3 py-2 text-right">Δ latest</th>
                  <th className="px-3 py-2 text-right">Δ%</th>
                  <th className="px-3 py-2 text-left">Sector</th>
                  <th className="px-3 py-2 text-left">Volatility</th>
                  <th className="px-3 py-2 text-left">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((row) => (
                  <tr key={row.tld} className="bg-background/40">
                    <td className="px-3 py-2 rf-mono-digits">
                      <Link href={`/tld/${encodeURIComponent(row.tld)}`} className="hover:text-primary">
                        .{row.tld}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{fmtInt(row.count)}</td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{fmtPct(row.sharePct / 100)}</td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{row.deltaAbs === null ? "n/a" : fmtSignedInt(row.deltaAbs)}</td>
                    <td className="px-3 py-2 text-right rf-mono-digits">{row.deltaPct === null ? "n/a" : fmtPct(row.deltaPct)}</td>
                    <td className="px-3 py-2 rf-mono-digits">{row.sector}</td>
                    <td className="px-3 py-2 rf-mono-digits">{volatilityPosition(row)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/runs/${encodeURIComponent(activeRunId)}`} className="text-cyan-200 hover:text-cyan-100">
                        run
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </main>
  );
}

