import type { Metadata } from "next";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

export const metadata: Metadata = {
  title: "Integration Runbooks",
  description: "Operational integration runbooks for RootFetch with Splunk, Microsoft Sentinel, and SOAR webhooks.",
  alternates: {
    canonical: "/docs/integrations",
  },
};

export default function IntegrationsDocsPage() {
  const compareApiExample = `curl -sS "${siteUrl}/mcp" \\
  -X POST \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rootfetch.compare_link","arguments":{"left":"<left_run_id>","right":"<right_run_id>"}}}'`;

  const splunkSearch = `| makeresults
| eval rootfetch_compare_url="${siteUrl}/compare?left=<left_run_id>&right=<right_run_id>"
| eval rootfetch_run_left="<left_run_id>"
| eval rootfetch_run_right="<right_run_id>"
| table rootfetch_run_left rootfetch_run_right rootfetch_compare_url`;

  const sentinelKql = `let left_run = "<left_run_id>";
let right_run = "<right_run_id>";
print
  rootfetch_left_run = left_run,
  rootfetch_right_run = right_run,
  rootfetch_compare = strcat("${siteUrl}/compare?left=", left_run, "&right=", right_run)`;

  const soarPayload = `{
  "source": "rootfetch",
  "kind": "structural_compare",
  "left_run_id": "<left_run_id>",
  "right_run_id": "<right_run_id>",
  "compare_url": "${siteUrl}/compare?left=<left_run_id>&right=<right_run_id>",
  "evidence": {
    "left_manifest": "${siteUrl}/rootfetch/artifacts/runs/<left_run_id>/manifest.json",
    "right_manifest": "${siteUrl}/rootfetch/artifacts/runs/<right_run_id>/manifest.json"
  }
}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Integration Runbooks" subtitle="Use RootFetch as a verifiable structural layer inside existing SOC and analyst stacks.">
        <p className="text-sm text-muted-foreground">
          These runbooks do not replace your current platform. They add immutable run evidence, compare links,
          and manifest-backed citations to existing workflows.
        </p>
      </Section>

      <Section title="Common Compare Primitive" subtitle="Generate compare links from immutable run IDs.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {compareApiExample}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={compareApiExample} keyName="integrations_compare_api" context="integrations_docs" />
        </div>
      </Section>

      <Section title="Splunk Runbook" subtitle="Attach RootFetch run-pair evidence to existing detections and reports.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {splunkSearch}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={splunkSearch} keyName="integrations_splunk_search" context="integrations_docs" />
        </div>
      </Section>

      <Section title="Microsoft Sentinel Runbook" subtitle="Use a small KQL helper block for analyst pivots and incident context.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {sentinelKql}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={sentinelKql} keyName="integrations_sentinel_kql" context="integrations_docs" />
        </div>
      </Section>

      <Section title="SOAR Webhook Runbook" subtitle="Send immutable run-pair evidence through existing webhook automations.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {soarPayload}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={soarPayload} keyName="integrations_soar_payload" context="integrations_docs" />
        </div>
      </Section>

      <Section title="Related Docs">
        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href="https://github.com/khalidsaidi/rootfetch/tree/main/rootfetch-examples/integration-packs"
            className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Integration pack files
          </a>
          <TrackedLink href="/for-teams/workflows" label="integrations_workflows" pageType="integrations_docs" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Workflow runbooks
          </TrackedLink>
          <TrackedLink href="/docs/mcp" label="integrations_mcp" pageType="integrations_docs" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            MCP docs
          </TrackedLink>
          <TrackedLink href="/docs/public-endpoints" label="integrations_endpoints" pageType="integrations_docs" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Public endpoints
          </TrackedLink>
        </div>
      </Section>

      <TrackedLink href="/" label="integrations_back_home" pageType="integrations_docs" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
