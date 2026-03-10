import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftRight, ExternalLink } from "lucide-react";

import Badge from "@/components/Badge";
import Callout from "@/components/Callout";
import CopyValueButton from "@/components/CopyValueButton";
import EmptyState from "@/components/EmptyState";
import Section from "@/components/Section";
import {
  loadArtifactLatestPointer,
  loadReplayIndex,
  loadRunCompareBundleById,
  type RunCompareBundle,
  type ReplayRunEntry,
} from "@/lib/rootfetch-data";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

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

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtDeltaInt(value: number): string {
  const rounded = Math.trunc(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US").format(rounded)}`;
}

function fmtDeltaFloat(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function reasonCodesFromModel(model: Record<string, unknown>): string[] {
  const regimeInputs = asRecord(model.regime_inputs);
  const deltaHhi = asNumber(regimeInputs.delta_hhi);
  const top10 = asNumber(regimeInputs.top10_share_delta);
  const median = asNumber(regimeInputs.median_delta);
  return [
    deltaHhi > 0 ? "HHI_UP" : deltaHhi < 0 ? "HHI_DOWN" : "HHI_FLAT",
    top10 > 0 ? "TOP10_SHARE_RISING" : top10 < 0 ? "TOP10_SHARE_FALLING" : "TOP10_SHARE_FLAT",
    median > 0 ? "MEDIAN_UP" : median < 0 ? "MEDIAN_DOWN" : "MEDIAN_FLAT",
  ];
}

type MoverRow = {
  tld: string;
  delta_abs: number;
  delta_pct: number;
  count: number;
};

function topMovers(bundle: RunCompareBundle): MoverRow[] {
  const signals = bundle.signals;
  const listRaw = Array.isArray(signals.top_movers_abs) && signals.top_movers_abs.length > 0
    ? signals.top_movers_abs
    : Array.isArray(signals.core_movers_abs)
      ? signals.core_movers_abs
      : [];
  return listRaw
    .map((row) => ({
      tld: asString((row as Record<string, unknown>).tld, ""),
      delta_abs: asNumber((row as Record<string, unknown>).delta_abs),
      delta_pct: asNumber((row as Record<string, unknown>).delta_pct),
      count: asNumber((row as Record<string, unknown>).count),
    }))
    .filter((row) => row.tld)
    .slice(0, 10);
}

function runTimestamp(bundle: RunCompareBundle): string {
  const manifest = asRecord(bundle.manifest);
  return asString(manifest.snapshot_ts_utc, asString(bundle.signals.date_utc, "n/a"));
}

function findRunEntry(rows: ReplayRunEntry[], runId: string): ReplayRunEntry | null {
  return rows.find((row) => row.run_id === runId) || null;
}

function pickerSection(
  rows: ReplayRunEntry[],
  leftValue: string,
  rightValue: string,
) {
  const sorted = [...rows].sort((a, b) =>
    asString(b.snapshot_ts_utc, "").localeCompare(asString(a.snapshot_ts_utc, "")),
  );
  const defaultLeft = leftValue || asString(sorted[0]?.run_id, "");
  const defaultRight = rightValue || asString(sorted[1]?.run_id, asString(sorted[0]?.run_id, ""));

  return (
    <Section
      title="Run Comparison"
      subtitle="Select two immutable run IDs from replay index. This comparison reads run-scoped artifacts only."
      className="rf-glass"
    >
      {sorted.length === 0 ? (
        <EmptyState
          title="No runs available to compare"
          description="Replay index has no run entries yet. Publish pipeline must emit run metadata first."
        />
      ) : (
        <form method="get" className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto] md:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Left run
            <select
              name="left"
              defaultValue={defaultLeft}
              className="w-full min-w-0 max-w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
            >
              {sorted.map((row) => (
                <option key={row.run_id} value={row.run_id}>
                  {asString(row.snapshot_ts_utc, "n/a")} • {row.run_id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            Right run
            <select
              name="right"
              defaultValue={defaultRight}
              className="w-full min-w-0 max-w-full rounded-lg border border-border/70 bg-background/70 px-2 py-2 text-sm text-foreground"
            >
              {sorted.map((row) => (
                <option key={row.run_id} value={row.run_id}>
                  {asString(row.snapshot_ts_utc, "n/a")} • {row.run_id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 w-full rounded-lg border border-border/70 px-3 text-sm hover:border-primary/50 md:w-auto"
          >
            Compare runs
          </button>
        </form>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Link href="/runs" className="rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
          Browse archive
        </Link>
        <a href="/rootfetch/artifacts/replay/index.json" className="rounded-lg border border-border/70 px-2.5 py-1.5 hover:border-primary/50">
          replay/index.json
        </a>
      </div>
    </Section>
  );
}

export const metadata: Metadata = {
  title: "Compare Runs",
  description: "Artifact-only comparison of immutable RootFetch runs.",
  alternates: {
    canonical: "/compare",
  },
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const params = await searchParams;
  const leftRaw = asString(params.left, "");
  const rightRaw = asString(params.right, "");
  const replay = await loadReplayIndex();
  const replayRows = Array.isArray(replay.runs) ? replay.runs : [];

  if (!leftRaw || !rightRaw) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
        {pickerSection(replayRows, leftRaw, rightRaw)}
      </main>
    );
  }

  let leftId = leftRaw;
  let rightId = rightRaw;

  if (leftId === "latest" || rightId === "latest") {
    const pointer = await loadArtifactLatestPointer();
    if (!pointer) {
      notFound();
    }
    const latestRunId = asString(pointer.run_id, "");
    if (!latestRunId) {
      notFound();
    }
    if (leftId === "latest") leftId = latestRunId;
    if (rightId === "latest") rightId = latestRunId;
    redirect(`/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`);
  }

  const leftEntry = findRunEntry(replayRows, leftId);
  const rightEntry = findRunEntry(replayRows, rightId);
  if (!leftEntry || !rightEntry) {
    notFound();
  }

  const [leftBundle, rightBundle] = await Promise.all([
    loadRunCompareBundleById(leftId),
    loadRunCompareBundleById(rightId),
  ]);
  if (!leftBundle || !rightBundle) {
    notFound();
  }

  const leftModel = asRecord(leftBundle.model);
  const rightModel = asRecord(rightBundle.model);
  const leftDviObj = asRecord(leftModel.dvi);
  const rightDviObj = asRecord(rightModel.dvi);
  const leftDvi = asNumber(leftDviObj.score);
  const rightDvi = asNumber(rightDviObj.score);
  const deltaDvi = rightDvi - leftDvi;
  const leftRegime = asString(leftModel.regime, "UNKNOWN").toUpperCase();
  const rightRegime = asString(rightModel.regime, "UNKNOWN").toUpperCase();
  const leftConfidence = asNumber(leftModel.regime_confidence);
  const rightConfidence = asNumber(rightModel.regime_confidence);
  const deltaConfidence = rightConfidence - leftConfidence;
  const leftObserved = asNumber(leftBundle.signals.counted_today_count);
  const rightObserved = asNumber(rightBundle.signals.counted_today_count);
  const leftCore = asNumber(leftBundle.coverage.counted_today_core_count);
  const rightCore = asNumber(rightBundle.coverage.counted_today_core_count);
  const leftRolling = asNumber(leftBundle.coverage.counted_today_rolling_count);
  const rightRolling = asNumber(rightBundle.coverage.counted_today_rolling_count);
  const leftMissing = asNumber(leftBundle.coverage.missing_ever_count);
  const rightMissing = asNumber(rightBundle.coverage.missing_ever_count);

  const leftInputs = asRecord(leftModel.regime_inputs);
  const rightInputs = asRecord(rightModel.regime_inputs);
  const leftDviComponents = asRecord(leftModel.dvi_components);
  const rightDviComponents = asRecord(rightModel.dvi_components);

  const inputRows = [
    { key: "delta_hhi", left: asNumber(leftInputs.delta_hhi), right: asNumber(rightInputs.delta_hhi) },
    {
      key: "top10_share_delta",
      left: asNumber(leftInputs.top10_share_delta),
      right: asNumber(rightInputs.top10_share_delta),
    },
    { key: "median_delta", left: asNumber(leftInputs.median_delta), right: asNumber(rightInputs.median_delta) },
    {
      key: "dispersion_norm",
      left: asNumber(leftDviComponents.dispersion_norm),
      right: asNumber(rightDviComponents.dispersion_norm),
    },
    {
      key: "anomaly_norm",
      left: asNumber(leftDviComponents.anomaly_norm),
      right: asNumber(rightDviComponents.anomaly_norm),
    },
    {
      key: "concentration_norm",
      left: asNumber(leftDviComponents.concentration_norm),
      right: asNumber(rightDviComponents.concentration_norm),
    },
  ];

  const leftReasons = reasonCodesFromModel(leftModel);
  const rightReasons = reasonCodesFromModel(rightModel);
  const addedReasons = rightReasons.filter((reason) => !leftReasons.includes(reason));
  const removedReasons = leftReasons.filter((reason) => !rightReasons.includes(reason));

  const leftMovers = topMovers(leftBundle);
  const rightMovers = topMovers(rightBundle);
  const leftMap = new Map(leftMovers.map((item) => [item.tld, item]));
  const rightMap = new Map(rightMovers.map((item) => [item.tld, item]));
  const newMovers = rightMovers.filter((item) => !leftMap.has(item.tld)).map((item) => item.tld);
  const droppedMovers = leftMovers.filter((item) => !rightMap.has(item.tld)).map((item) => item.tld);
  const changedMagnitude = rightMovers
    .filter((item) => leftMap.has(item.tld))
    .map((item) => ({
      tld: item.tld,
      delta_abs_change: item.delta_abs - asNumber(leftMap.get(item.tld)?.delta_abs),
    }))
    .filter((item) => Math.abs(item.delta_abs_change) > 0)
    .sort((a, b) => Math.abs(b.delta_abs_change) - Math.abs(a.delta_abs_change))
    .slice(0, 10);

  const degradedPaths = Array.from(new Set([...leftBundle.missingPaths, ...rightBundle.missingPaths])).sort();
  const isDegraded = leftBundle.degraded || rightBundle.degraded;

  const swapHref = `/compare?left=${encodeURIComponent(rightId)}&right=${encodeURIComponent(leftId)}`;
  const leftRunHref = `/runs/${encodeURIComponent(leftId)}`;
  const rightRunHref = `/runs/${encodeURIComponent(rightId)}`;
  const compareHref = `/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`;
  const leftSnapshotTs = runTimestamp(leftBundle);
  const rightSnapshotTs = runTimestamp(rightBundle);
  const leftModelVersion = asString(leftModel.model_version, "n/a");
  const rightModelVersion = asString(rightModel.model_version, "n/a");
  const citationSnippet = [
    "RootFetch Structural Evidence",
    `left_run_id: ${leftId}`,
    `right_run_id: ${rightId}`,
    `left_snapshot_ts_utc: ${leftSnapshotTs}`,
    `right_snapshot_ts_utc: ${rightSnapshotTs}`,
    `left_model_version: ${leftModelVersion}`,
    `right_model_version: ${rightModelVersion}`,
    `dvi: ${leftDvi.toFixed(1)} -> ${rightDvi.toFixed(1)}`,
    `regime: ${leftRegime} -> ${rightRegime}`,
    `regime_confidence: ${leftConfidence.toFixed(3)} -> ${rightConfidence.toFixed(3)}`,
    `left_manifest_sha256: ${asString(leftBundle.manifestSha256, "n/a")}`,
    `right_manifest_sha256: ${asString(rightBundle.manifestSha256, "n/a")}`,
    `compare_url: ${compareHref}`,
    `left_run_url: ${leftRunHref}`,
    `right_run_url: ${rightRunHref}`,
  ].join("\n");

  return (
    <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      {pickerSection(replayRows, leftId, rightId)}

      <Section title="Run-to-Run Compare" subtitle="Artifact-only comparison (no recompute).">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={isDegraded ? "warning" : "success"}>
            {isDegraded ? "Degraded compare" : "Integrity: run-scoped artifacts"}
          </Badge>
          <Link href={swapHref} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs hover:border-primary/50">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Swap
          </Link>
          <Link href="/runs" className="rounded-lg border border-border/70 px-2.5 py-1.5 text-xs hover:border-primary/50">
            Back to archive
          </Link>
        </div>

        {isDegraded ? (
          <Callout variant="warning">
            <span className="break-all">Missing artifact paths: {degradedPaths.join(", ")}</span>
          </Callout>
        ) : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Left run</p>
            <p className="mt-1 break-all rf-mono-digits text-sm font-semibold">{leftId}</p>
            <p className="mt-1 text-xs text-muted-foreground">Snapshot: {leftSnapshotTs}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyValueButton value={leftId} keyName="compare_left_run_id" context="compare_runs" />
              <CopyValueButton value={asString(leftBundle.manifestSha256, "n/a")} keyName="compare_left_manifest_sha" context="compare_runs" />
              <Link href={leftRunHref} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50">
                Open run page <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Right run</p>
            <p className="mt-1 break-all rf-mono-digits text-sm font-semibold">{rightId}</p>
            <p className="mt-1 text-xs text-muted-foreground">Snapshot: {rightSnapshotTs}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyValueButton value={rightId} keyName="compare_right_run_id" context="compare_runs" />
              <CopyValueButton value={asString(rightBundle.manifestSha256, "n/a")} keyName="compare_right_manifest_sha" context="compare_runs" />
              <Link href={rightRunHref} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50">
                Open run page <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Copy Structural Citation" subtitle="One-click run-pair citation block for briefs and incident notes.">
        <pre className="max-w-full overflow-auto rounded-lg border border-border/70 bg-background/70 p-3 text-xs rf-mono-digits whitespace-pre-wrap break-all">
          {citationSnippet}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyValueButton value={citationSnippet} keyName="compare_structural_citation" context="compare_runs" />
          <CopyValueButton value={compareHref} keyName="compare_url" context="compare_runs" />
        </div>
      </Section>

      <Section title="Summary Deltas" subtitle="Right run minus left run.">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ DVI</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtDeltaFloat(deltaDvi, 1)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Regime change</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{leftRegime} → {rightRegime}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ confidence</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtDeltaFloat(deltaConfidence, 3)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ observed today</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtDeltaInt(rightObserved - leftObserved)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ core today</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtDeltaInt(rightCore - leftCore)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Δ rolling today</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtDeltaInt(rightRolling - leftRolling)}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Not yet observed</p>
            <p className="mt-1 rf-mono-digits text-sm">
              left {fmtInt(leftMissing)} → right {fmtInt(rightMissing)} ({fmtDeltaInt(rightMissing - leftMissing)})
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Model versions</p>
            <p className="mt-1 rf-mono-digits text-sm">
              {asString(leftModel.model_version, "n/a")} → {asString(rightModel.model_version, "n/a")}
            </p>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          title="Regime Inputs Delta"
          subtitle="Direct comparison of model inputs/components from model_latest.json."
          className="min-w-0"
        >
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-2 py-2">Input</th>
                  <th className="px-2 py-2">Left</th>
                  <th className="px-2 py-2">Right</th>
                  <th className="px-2 py-2">Delta</th>
                </tr>
              </thead>
              <tbody>
                {inputRows.map((row) => (
                  <tr key={row.key} className="border-b border-border/50">
                    <td className="px-2 py-2 rf-mono-digits">{row.key}</td>
                    <td className="px-2 py-2 rf-mono-digits">{row.left.toFixed(6)}</td>
                    <td className="px-2 py-2 rf-mono-digits">{row.right.toFixed(6)}</td>
                    <td className="px-2 py-2 rf-mono-digits">{fmtDeltaFloat(row.right - row.left, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Reason codes added</p>
              <p className="mt-1 text-sm rf-mono-digits">{addedReasons.length ? addedReasons.join(", ") : "none"}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Reason codes removed</p>
              <p className="mt-1 text-sm rf-mono-digits">{removedReasons.length ? removedReasons.join(", ") : "none"}</p>
            </div>
          </div>
        </Section>

        <Section title="Movers Delta" subtitle="Top movers list compare from signals_latest.json (no recompute)." className="min-w-0">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Left top movers</p>
              <ul className="mt-2 space-y-1 text-sm">
                {leftMovers.length === 0 ? <li className="text-muted-foreground">none</li> : null}
                {leftMovers.map((row) => (
                  <li key={`left-${row.tld}`} className="rf-mono-digits">
                    .{row.tld} {fmtDeltaInt(row.delta_abs)} ({fmtPct(row.delta_pct)})
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Right top movers</p>
              <ul className="mt-2 space-y-1 text-sm">
                {rightMovers.length === 0 ? <li className="text-muted-foreground">none</li> : null}
                {rightMovers.map((row) => (
                  <li key={`right-${row.tld}`} className="rf-mono-digits">
                    .{row.tld} {fmtDeltaInt(row.delta_abs)} ({fmtPct(row.delta_pct)})
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">New movers</p>
              <p className="mt-1 text-sm rf-mono-digits">{newMovers.length ? newMovers.map((t) => `.${t}`).join(", ") : "none"}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Dropped movers</p>
              <p className="mt-1 text-sm rf-mono-digits">{droppedMovers.length ? droppedMovers.map((t) => `.${t}`).join(", ") : "none"}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Changed magnitude</p>
              <ul className="mt-1 space-y-1 text-sm">
                {changedMagnitude.length === 0 ? <li className="text-muted-foreground">none</li> : null}
                {changedMagnitude.map((row) => (
                  <li key={row.tld} className="rf-mono-digits">
                    .{row.tld} {fmtDeltaInt(row.delta_abs_change)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      </div>

      <Section title="Evidence Links" subtitle="Direct immutable artifact links used by this comparison.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Left run evidence</p>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              <Link href={leftRunHref} className="break-all text-cyan-200 hover:text-cyan-100">/runs/{leftId}</Link>
              <a href={`${leftBundle.baseHref}/model_latest.json`} className="text-cyan-200 hover:text-cyan-100">model_latest.json</a>
              <a href={`${leftBundle.baseHref}/signals_latest.json`} className="text-cyan-200 hover:text-cyan-100">signals_latest.json</a>
              <a href={`${leftBundle.baseHref}/coverage_latest.json`} className="text-cyan-200 hover:text-cyan-100">coverage_latest.json</a>
              <a href={`${leftBundle.baseHref}/manifest.json`} className="text-cyan-200 hover:text-cyan-100">manifest.json</a>
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Right run evidence</p>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              <Link href={rightRunHref} className="break-all text-cyan-200 hover:text-cyan-100">/runs/{rightId}</Link>
              <a href={`${rightBundle.baseHref}/model_latest.json`} className="text-cyan-200 hover:text-cyan-100">model_latest.json</a>
              <a href={`${rightBundle.baseHref}/signals_latest.json`} className="text-cyan-200 hover:text-cyan-100">signals_latest.json</a>
              <a href={`${rightBundle.baseHref}/coverage_latest.json`} className="text-cyan-200 hover:text-cyan-100">coverage_latest.json</a>
              <a href={`${rightBundle.baseHref}/manifest.json`} className="text-cyan-200 hover:text-cyan-100">manifest.json</a>
            </div>
          </div>
        </div>
      </Section>
    </main>
  );
}
