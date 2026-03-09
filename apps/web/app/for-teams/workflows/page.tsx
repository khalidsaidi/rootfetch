import type { Metadata } from "next";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

export const metadata: Metadata = {
  title: "RootFetch Workflow Runbooks",
  description:
    "Three practical analyst workflows for using RootFetch with broad intelligence platforms while preserving verifiable evidence.",
  alternates: {
    canonical: "/for-teams/workflows",
  },
};

export default function WorkflowRunbooksPage() {
  const citationBlock = `RootFetch Structural Evidence
run_id: <run_id>
snapshot_ts_utc: <snapshot_ts_utc>
model_version: <model_version>
dvi: <old> -> <new>
regime: <old> -> <new>
top10_share_pct: <old> -> <new>
manifest_hash_left: <sha256>
manifest_hash_right: <sha256>
evidence_links:
  - ${siteUrl}/runs/<run_id>
  - ${siteUrl}/compare?left=<left_run_id>&right=<right_run_id>`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section
        title="RootFetch + Big Suites Workflow Runbooks"
        subtitle="Operational patterns for analysts and security teams."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          These runbooks are designed for teams already using broad intelligence platforms. RootFetch provides
          the run-scoped structural evidence layer that keeps published claims reproducible and auditable.
        </p>
      </Section>

      <Section title="Runbook 1: Market Shift Validation" subtitle="Use vendor trend signals, validate with RootFetch evidence.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Trigger: a vendor trend or ranking view shows a sudden namespace concentration or dispersion shift.</li>
          <li>Action: open RootFetch <code>/compare</code> for the same period using consecutive immutable runs.</li>
          <li>Validate: check DVI, regime, top10 share, and manifest verification for both runs.</li>
          <li>Output: publish a structural note with compare URL and run IDs only.</li>
          <li>Guardrail: do not label a structural shift without a run-paired artifact delta.</li>
        </ul>
      </Section>

      <Section title="Runbook 2: SOC Triage Escalation" subtitle="Use broad enrichment for context, RootFetch for structural confirmation.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Trigger: SOC sees elevated suspicious activity linked to one namespace segment.</li>
          <li>Action: investigate entities in existing suite; in parallel fetch RootFetch <code>rootfetch.run_bundle</code>.</li>
          <li>Validate: confirm whether anomaly rows and concentration metrics shifted at namespace level.</li>
          <li>Output: incident note that separates entity-level risk from structural namespace movement.</li>
          <li>Guardrail: no regime claim unless artifacts show regime or DVI-band transition.</li>
        </ul>
      </Section>

      <Section title="Runbook 3: Weekly Analyst Briefing" subtitle="Build repeatable external updates with citation-grade evidence.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Trigger: scheduled weekly or monthly publication window.</li>
          <li>Action: summarize top movers and concentration changes from latest vs prior run.</li>
          <li>Validate: verify run manifests and include model version transition disclosure when applicable.</li>
          <li>Output: publish brief with one structural citation block per major claim.</li>
          <li>Guardrail: do not aggregate cross-model metrics without explicit model transition disclosure.</li>
        </ul>
      </Section>

      <Section title="Copy-Ready Structural Citation">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {citationBlock}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={citationBlock} keyName="workflow_citation_block" context="for_teams_workflows" />
        </div>
      </Section>

      <Section title="Jump Links">
        <div className="flex flex-wrap gap-2 text-xs">
          <TrackedLink href="/for-teams" label="workflows_for_teams_home" pageType="for_teams_workflows" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            For teams overview
          </TrackedLink>
          <TrackedLink href="/docs/mcp" label="workflows_mcp_docs" pageType="for_teams_workflows" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            MCP docs
          </TrackedLink>
          <TrackedLink href="/recipes" label="workflows_recipes" pageType="for_teams_workflows" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Recipes
          </TrackedLink>
          <TrackedLink href="/compare" label="workflows_compare" pageType="for_teams_workflows" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Compare
          </TrackedLink>
          <TrackedLink href="/runs" label="workflows_runs" pageType="for_teams_workflows" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Runs
          </TrackedLink>
        </div>
      </Section>

      <TrackedLink href="/" label="workflows_back_home" pageType="for_teams_workflows" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
