import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import { loadOpsScoreboard } from "@/lib/rootfetch-data";

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export const metadata: Metadata = {
  title: "Operations Scoreboard",
  description: "Cadence, reliability, and adoption KPIs generated from immutable run artifacts and ops logs.",
  alternates: {
    canonical: "/ops",
  },
};

export default async function OpsScoreboardPage() {
  const kpi = await loadOpsScoreboard();

  const run30Progress = Math.min(
    100,
    Math.round((kpi.run_reliability.runs_30d / Math.max(1, kpi.targets_90d.design_partner_teams * 3)) * 100),
  );
  const citationProgress = Math.min(
    100,
    Math.round((kpi.adoption.external_citations_logged_ytd / Math.max(1, kpi.targets_90d.external_citations)) * 100),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Operations Scoreboard" subtitle="Generated from replay index and operator logs under data/ops/.">
        <p className="text-sm text-muted-foreground">
          This page tracks operating discipline: run reliability, publication cadence, and adoption evidence.
          It is updated by the local daily pipeline.
        </p>
      </Section>

      <Section title="Run Reliability">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Latest run age (hours)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{kpi.run_reliability.latest_run_age_hours.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Runs (7d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmt(kpi.run_reliability.runs_7d)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Runs (30d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{fmt(kpi.run_reliability.runs_30d)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Max gap 7d (hours)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{kpi.run_reliability.max_gap_hours_7d.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Max gap 30d (hours)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{kpi.run_reliability.max_gap_hours_30d.toFixed(2)}</p>
          </div>
        </div>
      </Section>

      <Section title="Cadence + Adoption">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Publication cadence</p>
            <p className="mt-2 text-sm">Briefs published YTD: <span className="rf-mono-digits">{fmt(kpi.publication_cadence.briefs_published_ytd)}</span></p>
            <p className="mt-1 text-sm">Drills logged YTD: <span className="rf-mono-digits">{fmt(kpi.publication_cadence.drills_logged_ytd)}</span></p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Adoption evidence</p>
            <p className="mt-2 text-sm">External citations logged YTD: <span className="rf-mono-digits">{fmt(kpi.adoption.external_citations_logged_ytd)}</span></p>
            <p className="mt-1 text-sm">Adoption log entries YTD: <span className="rf-mono-digits">{fmt(kpi.adoption.adoption_log_entries_ytd)}</span></p>
            <p className="mt-2 text-xs text-muted-foreground">{kpi.adoption.note}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Runs progress proxy</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{run30Progress}%</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Citations progress</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{citationProgress}%</p>
          </div>
        </div>
      </Section>

      <Section title="Targets (90 days)">
        <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Run completion rate target: {kpi.targets_90d.run_completion_rate_pct}%</li>
          <li>Design-partner teams target: {kpi.targets_90d.design_partner_teams}</li>
          <li>External citations target: {kpi.targets_90d.external_citations}</li>
          <li>Weekly active MCP clients target: {kpi.targets_90d.weekly_active_mcp_clients}</li>
        </ul>
      </Section>

      <div className="flex flex-wrap gap-2 text-xs">
        <TrackedLink href="/for-teams" label="ops_for_teams" pageType="ops" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
          For teams
        </TrackedLink>
        <TrackedLink href="/for-teams/workflows" label="ops_workflows" pageType="ops" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
          Workflow runbooks
        </TrackedLink>
        <TrackedLink href="/docs/integrations" label="ops_integrations" pageType="ops" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
          Integration runbooks
        </TrackedLink>
      </div>
    </main>
  );
}
