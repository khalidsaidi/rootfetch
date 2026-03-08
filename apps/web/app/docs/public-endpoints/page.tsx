import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "Public Endpoints",
  description: "Canonical public RootFetch endpoints for MCP, discovery, and immutable artifacts.",
  alternates: {
    canonical: "/docs/public-endpoints",
  },
};

export default function PublicEndpointsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Public Endpoints" subtitle="Canonical URLs for operators and integrators.">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>MCP: <code>https://rootfetch.com/mcp</code></li>
          <li>MCP health: <code>https://rootfetch.com/mcp/health</code></li>
          <li>MCP readiness: <code>https://rootfetch.com/mcp/readyz</code></li>
          <li>MCP usage dashboard: <code>https://rootfetch.com/mcp/usage</code></li>
          <li>MCP usage stats API: <code>https://rootfetch.com/api/mcp/stats?days=7</code></li>
          <li>MCP usage events API: <code>https://rootfetch.com/api/mcp/events?limit=50</code></li>
          <li>OpenAPI: <code>https://rootfetch.com/openapi.json</code></li>
          <li>AIR: <code>https://rootfetch.com/air.json</code></li>
          <li>AI Plugin: <code>https://rootfetch.com/ai-plugin.json</code></li>
          <li>Agent discovery: <code>https://rootfetch.com/.well-known/agent.json</code></li>
        </ul>
      </Section>

      <Section title="Artifact Endpoints">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>Latest pointer: <code>/rootfetch/artifacts/latest.json</code></li>
          <li>Replay index: <code>/rootfetch/artifacts/replay/index.json</code></li>
          <li>Run manifest: <code>/rootfetch/artifacts/runs/&lt;run_id&gt;/manifest.json</code></li>
        </ul>
      </Section>

      <Section title="Usage Event Notes">
        <p className="text-sm text-muted-foreground">
          RootFetch exposes read-only MCP usage and event endpoints. These are telemetry views only; no public write ingestion
          endpoint is exposed.
        </p>
      </Section>

      <TrackedLink href="/docs/mcp" label="back_mcp_docs" pageType="public_endpoints_docs" className="text-sm text-primary hover:text-primary/80">
        Back to MCP docs
      </TrackedLink>
    </main>
  );
}
