import type { Metadata } from "next";
import Link from "next/link";
import { Clock3, ExternalLink, History } from "lucide-react";

import CopyValueButton from "@/components/CopyValueButton";
import EmptyState from "@/components/EmptyState";
import Section from "@/components/Section";
import { loadReplayIndex } from "@/lib/rootfetch-data";

import RunsArchiveClient, { type RunsArchiveRow } from "./RunsArchiveClient";

function asString(value: unknown, fallback = "n/a"): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferBand(score: number): "stable" | "elevated" | "active" | "turbulent" {
  if (score >= 75) return "turbulent";
  if (score >= 50) return "active";
  if (score >= 25) return "elevated";
  return "stable";
}

function dateFromTimestamp(snapshotTsUtc: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(snapshotTsUtc)) {
    return snapshotTsUtc;
  }
  if (snapshotTsUtc.length >= 10) {
    return snapshotTsUtc.slice(0, 10);
  }
  return "n/a";
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export const metadata: Metadata = {
  title: "Run Archive",
  description: "Immutable historical run archive for RootFetch structural snapshots.",
  alternates: {
    canonical: "/runs",
  },
};

export default async function RunsArchivePage() {
  const replay = await loadReplayIndex();

  const rows: RunsArchiveRow[] = (Array.isArray(replay.runs) ? replay.runs : [])
    .map((entry) => {
      const runId = asString(entry.run_id, "");
      if (!runId) {
        return null;
      }
      const dviObj = entry.dvi && typeof entry.dvi === "object" ? entry.dvi : {};
      const dviScore = asNumber((dviObj as { score?: number }).score);
      const snapshotTs = asString(entry.snapshot_ts_utc, "");
      const snapshotDay = asString(entry.snapshot_utc_day, dateFromTimestamp(snapshotTs));
      return {
        run_id: runId,
        snapshot_ts_utc: snapshotTs || `${snapshotDay}T00:00:00Z`,
        snapshot_utc_day: snapshotDay,
        model_version: asString(entry.model_version, "n/a"),
        regime: asString(entry.regime, "UNKNOWN").toUpperCase(),
        regime_confidence: asNumber(entry.regime_confidence),
        dvi_score: dviScore,
        dvi_band: inferBand(dviScore),
      } as RunsArchiveRow;
    })
    .filter((row): row is RunsArchiveRow => row !== null)
    .sort((left, right) => right.snapshot_ts_utc.localeCompare(left.snapshot_ts_utc));

  const latestRun = rows[0] || null;
  const oldestRun = rows[rows.length - 1] || null;
  const modelVersions = Array.from(new Set(rows.map((row) => row.model_version).filter((value) => value !== "n/a")));
  const currentModelVersion = latestRun?.model_version || "n/a";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section
        title="Run Archive"
        subtitle="Immutable historical snapshots of namespace structure. Powered only by /rootfetch/artifacts/replay/index.json."
        className="rf-glass"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Total runs available</p>
            <p className="mt-1 rf-mono-digits text-2xl font-semibold">{fmtInt(rows.length)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Date range</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">
              {oldestRun ? oldestRun.snapshot_utc_day : "n/a"} → {latestRun ? latestRun.snapshot_utc_day : "n/a"}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Current model version</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{currentModelVersion}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Model variants in archive</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{fmtInt(modelVersions.length)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {latestRun ? (
            <>
              <Link
                href={`/runs/${encodeURIComponent(latestRun.run_id)}`}
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
              >
                <Clock3 className="h-3.5 w-3.5" />
                Latest run
              </Link>
              <CopyValueButton value={latestRun.run_id} keyName="latest_run_id" context="runs_archive_header" />
            </>
          ) : null}
          <a
            href="/rootfetch/artifacts/replay/index.json"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50"
          >
            replay/index.json <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            Run list is immutable and run-scoped.
          </span>
        </div>
      </Section>

      {rows.length === 0 ? (
        <EmptyState
          title="No runs published yet"
          description="Publish pipeline has not emitted replay index entries yet. Check /rootfetch/artifacts/replay/index.json."
        />
      ) : (
        <RunsArchiveClient rows={rows} />
      )}
    </main>
  );
}

