import type { Metadata } from "next";
import Link from "next/link";

import AlertControlPanel from "@/components/home/AlertControlPanel";
import Section from "@/components/Section";
import { loadLatest, loadPublishedRunBundle } from "@/lib/rootfetch-data";

type AlertRow = {
  tld: string;
  delta_pct: number;
  robust_z?: number;
  sector?: string;
};

function asNumber(value: unknown): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function anomalyRowsFromSignals(signals: Record<string, unknown>): AlertRow[] {
  const spotlight = Array.isArray(signals.anomaly_spotlight)
    ? (signals.anomaly_spotlight as Array<Record<string, unknown>>)
    : [];
  if (spotlight.length > 0) {
    return spotlight
      .filter((row) => typeof row?.tld === "string" && String(row.tld).length > 0)
      .map((row) => ({
        tld: String(row.tld),
        delta_pct: asNumber(row.delta_pct),
        robust_z: row.robust_z == null ? undefined : asNumber(row.robust_z),
        sector: typeof row.sector === "string" ? row.sector : "other",
      }));
  }

  const anomalies = Array.isArray(signals.anomalies)
    ? (signals.anomalies as Array<Record<string, unknown>>)
    : [];
  return anomalies
    .filter((row) => typeof row?.tld === "string" && String(row.tld).length > 0)
    .slice(0, 24)
    .map((row) => ({
      tld: String(row.tld),
      delta_pct: asNumber(row.delta_pct),
      robust_z: row.robust_z == null ? undefined : asNumber(row.robust_z),
      sector: typeof row.sector === "string" ? row.sector : "other",
    }));
}

export const metadata: Metadata = {
  title: "Admin Alerts",
  description: "Operator-only alert simulation controls for RootFetch.",
  alternates: {
    canonical: "/admin/alerts",
  },
};

export default async function AdminAlertsPage() {
  const published = await loadPublishedRunBundle();
  const latest = (published?.signals as Record<string, unknown> | undefined) ?? ((await loadLatest()) as Record<string, unknown>);
  const concentration = latest.concentration && typeof latest.concentration === "object"
    ? (latest.concentration as Record<string, unknown>)
    : {};
  const dvi = latest.dvi && typeof latest.dvi === "object" ? (latest.dvi as Record<string, unknown>) : {};

  const rows = anomalyRowsFromSignals(latest);
  const dviScore = asNumber(dvi.score);
  const top10SharePct = asNumber(concentration.top10_share_pct);
  const runId = typeof latest.run_id === "string" ? latest.run_id : "n/a";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Alert Simulation Console" subtitle="Operator-only simulation surface. No live subscriptions are modified here.">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 px-2 py-1">Run: {runId}</span>
          <Link href="/admin/usage" className="rounded-full border border-border/70 px-2 py-1 hover:border-primary/50">
            usage dashboard
          </Link>
          <Link href="/admin/agent-events" className="rounded-full border border-border/70 px-2 py-1 hover:border-primary/50">
            event log
          </Link>
        </div>
        <AlertControlPanel rows={rows} dviScore={dviScore} top10SharePct={top10SharePct} />
      </Section>
    </main>
  );
}
