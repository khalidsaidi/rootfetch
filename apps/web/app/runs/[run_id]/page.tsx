import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileCheck2, ShieldAlert, ShieldCheck } from "lucide-react";

import Badge from "@/components/Badge";
import Callout from "@/components/Callout";
import CopyValueButton from "@/components/CopyValueButton";
import EmptyState from "@/components/EmptyState";
import MetricPill from "@/components/MetricPill";
import Section from "@/components/Section";
import SectionHeader from "@/components/SectionHeader";
import { loadRunBundleById } from "@/lib/rootfetch-data";

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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSigned(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(6)}`;
}

function dviBandFromScore(score: number): string {
  if (score >= 75) return "turbulent";
  if (score >= 50) return "active";
  if (score >= 25) return "elevated";
  return "stable";
}

function toneForBand(band: string): "success" | "warning" | "danger" | "default" {
  const normalized = band.toLowerCase();
  if (normalized === "stable") return "success";
  if (normalized === "elevated") return "warning";
  if (normalized === "active" || normalized === "turbulent") return "danger";
  return "default";
}

function reasonCodes(deltaHhi: number, top10ShareDelta: number, medianDelta: number): string[] {
  const output: string[] = [];
  output.push(deltaHhi > 0 ? "HHI_UP" : deltaHhi < 0 ? "HHI_DOWN" : "HHI_FLAT");
  output.push(
    top10ShareDelta > 0 ? "TOP10_SHARE_RISING" : top10ShareDelta < 0 ? "TOP10_SHARE_FALLING" : "TOP10_SHARE_FLAT",
  );
  output.push(medianDelta > 0 ? "MEDIAN_UP" : medianDelta < 0 ? "MEDIAN_DOWN" : "MEDIAN_FLAT");
  return output;
}

export async function generateMetadata({ params }: { params: Promise<{ run_id: string }> }): Promise<Metadata> {
  const { run_id: runId } = await params;
  const run = await loadRunBundleById(runId);
  const safeRunId = asString(runId, "unknown-run");

  if (!run) {
    return {
      title: `Run ${safeRunId} Not Found`,
      description: `RootFetch run ${safeRunId} was not found in immutable artifacts.`,
      alternates: { canonical: `/runs/${encodeURIComponent(safeRunId)}` },
    };
  }

  const model = asRecord(run.model);
  const regime = asString(model.regime, "n/a").toUpperCase();
  const dvi = asRecord(model.dvi);
  const dviScore = asNumber(dvi.score);

  return {
    title: `Run ${safeRunId} • ${regime} • DVI ${dviScore.toFixed(1)}`,
    description: `Immutable RootFetch evidence page for ${safeRunId}: model version, coverage summary, and artifact manifest links.`,
    alternates: { canonical: `/runs/${encodeURIComponent(safeRunId)}` },
  };
}

export default async function RunExplorerPage({ params }: { params: Promise<{ run_id: string }> }) {
  const { run_id: runId } = await params;
  const run = await loadRunBundleById(runId);
  if (!run) {
    notFound();
  }

  const model = asRecord(run.model);
  const manifest = asRecord(run.manifest);
  const filesRaw = Array.isArray(manifest.files) ? (manifest.files as Array<Record<string, unknown>>) : [];
  const manifestFiles = filesRaw
    .map((entry) => ({
      path: asString(entry.path, ""),
      size: asNumber(entry.size),
      sha256: asString(entry.sha256, ""),
    }))
    .filter((entry) => entry.path.length > 0);

  const dvi = asRecord(model.dvi);
  const dviScore = asNumber(dvi.score);
  const dviBand = asString(model.dvi_band || dvi.level || dviBandFromScore(dviScore)).toLowerCase();
  const regime = asString(model.regime, "n/a").toUpperCase();
  const regimeConfidence = asNumber(model.regime_confidence);
  const methodologyVersion = asString(model.methodology_version, "n/a");
  const modelVersion = asString(model.model_version || manifest.model_version, "n/a");
  const snapshotTsUtc = asString(manifest.snapshot_ts_utc || run.signals.date_utc, "n/a");
  const snapshotHash = asString(manifest.snapshot_hash, "n/a");

  const regimeInputs = asRecord(model.regime_inputs);
  const deltaHhi = asNumber(regimeInputs.delta_hhi);
  const top10ShareDelta = asNumber(regimeInputs.top10_share_delta);
  const medianDelta = asNumber(regimeInputs.median_delta);
  const reasons = reasonCodes(deltaHhi, top10ShareDelta, medianDelta);

  const integrityDegraded = run.missingPaths.length > 0 || run.checkedCount !== run.expectedCount;

  const approvedCount = run.coverage.approved_tlds_count || 0;
  const countedEver = run.coverage.counted_ever_count || 0;
  const missingEver = run.coverage.missing_ever_count || 0;
  const coreToday = run.coverage.counted_today_core_count || 0;
  const rollingToday = run.coverage.counted_today_rolling_count || 0;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";
  const runPageUrl = `${siteUrl}/runs/${encodeURIComponent(run.runId)}`;
  const citeSnippet = [
    `Run ID: ${run.runId}`,
    `Snapshot: ${snapshotTsUtc}`,
    `Model: ${modelVersion}`,
    `Manifest SHA: ${run.manifestSha256}`,
    `URL: ${runPageUrl}`,
  ].join("\n");

  const jsVerifyCmd = `node examples/verify-run.mjs ${run.runId}`;
  const pyVerifyCmd = `python3 examples/verify_run.py ${run.runId}`;

  const evidenceRows = [
    { label: "manifest.json", path: "manifest.json" },
    { label: "model_latest.json", path: "model_latest.json" },
    { label: "signals_latest.json", path: "signals_latest.json" },
    { label: "treemap_latest.json", path: "treemap_latest.json" },
    { label: "radar_latest.json", path: "radar_latest.json" },
    { label: "coverage_latest.json", path: "coverage_latest.json" },
    { label: "digest_latest.txt", path: "digest_latest.txt" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section
        title="Run Explorer"
        subtitle="Immutable, run-scoped evidence page. This route loads only /rootfetch/artifacts/runs/<run_id>/... files."
        className="rf-glass"
      >
        <SectionHeader
          title={run.runId}
          subtitle={`Snapshot UTC: ${snapshotTsUtc}`}
          actions={
            <>
              <CopyValueButton value={run.runId} keyName="run_id" context="run_explorer_header" />
              <CopyValueButton value={snapshotHash} keyName="snapshot_hash" context="run_explorer_header" />
              <a
                href={`${run.baseHref}/manifest.json`}
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50"
              >
                manifest <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          }
        />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Model version</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{modelVersion}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Methodology version</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">{methodologyVersion}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Snapshot hash</p>
            <p className="mt-1 rf-mono-digits text-xs font-semibold leading-tight break-all [overflow-wrap:anywhere]">{snapshotHash}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Manifest SHA256</p>
            <p className="mt-1 rf-mono-digits text-xs font-semibold leading-tight break-all [overflow-wrap:anywhere]">{run.manifestSha256}</p>
          </div>
        </div>
      </Section>

      <Section title="Integrity: Verifiable" subtitle="Manifest-driven integrity surface with copy-ready local verification commands.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {integrityDegraded ? (
            <Badge tone="warning">
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              Integrity: degraded
            </Badge>
          ) : (
            <Badge tone="success">
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              Integrity: verifiable
            </Badge>
          )}
          <MetricPill tone="safe">Manifest hashes: SHA256</MetricPill>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">expected_count</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(run.expectedCount)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">checked_count</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(run.checkedCount)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">manifest entries</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(manifestFiles.length)}</p>
          </div>
        </div>

        {run.missingPaths.length > 0 ? (
          <Callout variant="warning" className="mt-3">
            Missing artifact paths: {run.missingPaths.join(", ")}
          </Callout>
        ) : null}

        <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">How to verify locally (JS)</p>
            <pre className="mt-2 max-w-full overflow-x-auto rounded bg-muted/30 p-2 text-xs rf-mono-digits whitespace-pre-wrap break-all">{jsVerifyCmd}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyValueButton value={jsVerifyCmd} keyName="verify_js_cmd" context="run_explorer_integrity" />
              <CopyValueButton value="npm i rootfetch-sdk-js" keyName="install_js_sdk" context="run_explorer_integrity" />
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">How to verify locally (Python)</p>
            <pre className="mt-2 max-w-full overflow-x-auto rounded bg-muted/30 p-2 text-xs rf-mono-digits whitespace-pre-wrap break-all">{pyVerifyCmd}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyValueButton value={pyVerifyCmd} keyName="verify_py_cmd" context="run_explorer_integrity" />
              <CopyValueButton value="pip install rootfetch-sdk-py" keyName="install_py_sdk" context="run_explorer_integrity" />
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Live Zone Snapshot" subtitle="Frozen model outputs for this exact immutable run.">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={toneForBand(dviBand)}>DVI band: {dviBand.toUpperCase()}</Badge>
            <MetricPill tone="info">Regime: {regime}</MetricPill>
            <MetricPill tone="snapshot">Confidence: {fmtPct(regimeConfidence)}</MetricPill>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">DVI</p>
              <p className="mt-1 rf-mono-digits text-2xl font-semibold">{dviScore.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">Regime</p>
              <p className="mt-1 rf-mono-digits text-2xl font-semibold">{regime}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Regime inputs</p>
            <div className="mt-2 grid gap-2 text-sm rf-mono-digits sm:grid-cols-3">
              <p>delta_hhi: {fmtSigned(deltaHhi)}</p>
              <p>top10_share_delta: {fmtSigned(top10ShareDelta)}</p>
              <p>median_delta: {fmtSigned(medianDelta)}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {reasons.map((reason) => (
                <MetricPill key={reason} tone="snapshot">
                  {reason}
                </MetricPill>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Classification bands</p>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              {[
                { band: "stable", range: "0-25" },
                { band: "elevated", range: "25-50" },
                { band: "active", range: "50-75" },
                { band: "turbulent", range: "75-100" },
              ].map((item) => (
                <div
                  key={item.band}
                  className={`rounded border p-2 rf-mono-digits ${
                    item.band === dviBand ? "border-primary/60 bg-primary/10" : "border-border/70 bg-background/50"
                  }`}
                >
                  {item.band.toUpperCase()} ({item.range})
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Coverage Summary" subtitle="Coverage metrics for this run from coverage_latest.json.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">Universe tracked</p>
              <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(approvedCount)}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">Observed at least once</p>
              <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(countedEver)}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">Observed today (core)</p>
              <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(coreToday)}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">Observed today (rolling)</p>
              <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmtInt(rollingToday)}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Not yet observed</p>
            <p className={`mt-1 rf-mono-digits text-2xl font-semibold ${missingEver > 0 ? "text-amber-200" : "text-emerald-200"}`}>
              {fmtInt(missingEver)}
            </p>
          </div>
        </Section>
      </div>

      <Section title="Evidence Links" subtitle="Immutable artifact URLs for this run.">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-2 py-2">Artifact</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">URL</th>
              </tr>
            </thead>
            <tbody>
              {evidenceRows.map((row) => {
                const href = `${run.baseHref}/${row.path}`;
                const missing = run.missingPaths.includes(row.path);
                return (
                  <tr key={row.path} className="border-b border-border/50">
                    <td className="px-2 py-2 rf-mono-digits">{row.label}</td>
                    <td className="px-2 py-2">
                      <Badge tone={missing ? "warning" : "success"}>{missing ? "missing" : "present"}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <a href={href} className="inline-flex items-center gap-1 break-all text-cyan-200 hover:text-cyan-100">
                        {href} <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Cite This Run" subtitle="Copy-ready citation fields for reports and briefings.">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <pre className="max-w-full overflow-auto whitespace-pre-wrap break-all text-xs rf-mono-digits">{citeSnippet}</pre>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyValueButton value={citeSnippet} keyName="cite_run_snippet" context="run_explorer_cite" />
            <a
              href={runPageUrl}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50"
            >
              open permalink <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </Section>

        <Section title="Digest Snapshot" subtitle="Optional digest text for this run.">
          {run.digest ? (
            <pre className="max-h-80 max-w-full overflow-auto rounded-lg border border-border/70 bg-background/70 p-3 text-xs rf-mono-digits whitespace-pre-wrap break-all">
              {run.digest}
            </pre>
          ) : (
            <EmptyState title="Digest unavailable for this run" description="This run can still be audited via manifest and JSON artifacts." />
          )}
        </Section>
      </div>

      <Section title="Replay + Latest" subtitle="Fallback navigation when comparing immutable run evidence to moving pointers.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/runs" className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 hover:border-primary/50">
            browse all runs
          </Link>
          <Link
            href={`/compare?left=${encodeURIComponent(run.runId)}&right=latest`}
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 hover:border-primary/50"
          >
            compare to latest
          </Link>
          <Link href="/rootfetch/artifacts/replay/index.json" className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 hover:border-primary/50">
            replay index <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Link href="/rootfetch/artifacts/latest.json" className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 hover:border-primary/50">
            latest pointer <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <FileCheck2 className="h-4 w-4" />
            Immutable route: no `latest.json` fetches are performed inside this page.
          </span>
        </div>
      </Section>
    </main>
  );
}
