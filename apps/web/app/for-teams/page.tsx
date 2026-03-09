import type { Metadata } from "next";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

export const metadata: Metadata = {
  title: "RootFetch For Teams",
  description:
    "How to use RootFetch as a verifiable structural namespace layer alongside broad threat-intelligence suites.",
  alternates: {
    canonical: "/for-teams",
  },
};

export default function ForTeamsPage() {
  const citationTemplate = `RootFetch Structural Citation
run_id: <run_id>
snapshot_ts_utc: <snapshot_ts_utc>
model_version: <model_version>
dvi: <old> -> <new>
regime: <old> -> <new>
top10_share_pct: <old> -> <new>
manifest_left: <sha256>
manifest_right: <sha256>
evidence:
  - ${siteUrl}/runs/<run_id>
  - ${siteUrl}/compare?left=<left_run_id>&right=<right_run_id>`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="RootFetch For Teams" subtitle="A verifiable structural layer for namespace intelligence.">
        <p className="text-sm leading-relaxed text-muted-foreground">
          RootFetch is not a replacement for broad threat-intel suites. It is the evidence-grade layer that adds immutable
          runs, replay, compare, and manifest verification for structural namespace analysis.
        </p>
      </Section>

      <Section title="Where RootFetch Fits">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Use RootFetch when you need reproducible structural evidence tied to immutable artifacts.</li>
          <li>Use broad suites for enrichment breadth, threat context, and workflow automation across many data classes.</li>
          <li>Use both together when you need narrative speed and hard structural proof in one stack.</li>
        </ul>
      </Section>

      <Section title="Practical Split">
        <div className="overflow-auto rounded-lg border border-border/70">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-background/40 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">RootFetch</th>
                <th className="px-3 py-2">Broad Suites</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Can I replay exactly what was published?</td>
                <td className="px-3 py-2">Yes. Run-scoped immutable artifacts + manifests.</td>
                <td className="px-3 py-2">Varies by vendor/workflow.</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Can agents consume deterministic structural outputs?</td>
                <td className="px-3 py-2">Yes. Public MCP + artifact-backed API.</td>
                <td className="px-3 py-2">Often broader, sometimes less run-anchored.</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Can I cite every claim to immutable evidence?</td>
                <td className="px-3 py-2">Yes. Compare links + manifest hashes.</td>
                <td className="px-3 py-2">Varies by product and plan.</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Can I get broad enrichment across domains/IPs/threats?</td>
                <td className="px-3 py-2">Not the primary goal.</td>
                <td className="px-3 py-2">Yes. This is their strength.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Citation-Ready Format" subtitle="Use this block in briefs and external notes.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {citationTemplate}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={citationTemplate} keyName="for_teams_citation_template" context="for_teams_page" />
        </div>
      </Section>

      <Section title="Integration Paths">
        <div className="flex flex-wrap gap-2 text-xs">
          <TrackedLink href="/for-teams/workflows" label="for_teams_workflows" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Workflow runbooks
          </TrackedLink>
          <TrackedLink href="/docs/mcp" label="for_teams_mcp_docs" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            MCP docs
          </TrackedLink>
          <TrackedLink href="/recipes" label="for_teams_recipes" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Recipes
          </TrackedLink>
          <TrackedLink href="/docs/public-endpoints" label="for_teams_public_endpoints" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Public endpoints
          </TrackedLink>
          <TrackedLink href="/runs" label="for_teams_runs" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Runs archive
          </TrackedLink>
          <TrackedLink href="/compare" label="for_teams_compare" pageType="for_teams" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Compare
          </TrackedLink>
        </div>
      </Section>

      <TrackedLink href="/" label="for_teams_back_home" pageType="for_teams" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
