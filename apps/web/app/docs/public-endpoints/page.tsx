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
    <main className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8 [&_code]:break-all">
      <Section title="Public Endpoints" subtitle="Canonical URLs for operators and integrators.">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>MCP: <code>https://rootfetch.com/mcp</code></li>
          <li>MCP metadata JSON: <code>https://rootfetch.com/mcp?format=json</code></li>
          <li>MCP health: <code>https://rootfetch.com/mcp/health</code></li>
          <li>MCP healthz: <code>https://rootfetch.com/mcp/healthz</code></li>
          <li>MCP readiness: <code>https://rootfetch.com/mcp/readyz</code></li>
          <li>MCP first-call validator: <code>https://rootfetch.com/api/mcp/first-call</code></li>
          <li>MCP probe (seeding/test): <code>https://rootfetch.com/api/mcp/probe</code></li>
          <li>MCP outcome schemas: <code>https://rootfetch.com/api/mcp/outcome-schemas</code></li>
          <li>MCP hosting page: <code>https://rootfetch.com/docs/hosting/mcp/</code></li>
          <li>Agent integration guide: <code>https://rootfetch.com/agents</code></li>
          <li>Agent playground: <code>https://rootfetch.com/agents/playground</code></li>
          <li>Glama connector metadata: <code>https://rootfetch.com/.well-known/glama.json</code></li>
          <li>MCP live usage page (public): <code>https://rootfetch.com/mcp/live</code></li>
          <li>MCP public stats API: <code>https://rootfetch.com/api/mcp/public-stats?days=7</code></li>
          <li>MCP public events API: <code>https://rootfetch.com/api/mcp/public-events?limit=30</code></li>
          <li>MCP usage dashboard (admin): <code>https://rootfetch.com/admin/usage</code></li>
          <li>MCP agent events (admin): <code>https://rootfetch.com/admin/agent-events</code></li>
          <li>MCP usage stats API: <code>https://rootfetch.com/api/mcp/stats?days=7</code></li>
          <li>MCP usage events API: <code>https://rootfetch.com/api/mcp/events?limit=50</code></li>
          <li>OpenAPI: <code>https://rootfetch.com/openapi.json</code></li>
          <li>AIR: <code>https://rootfetch.com/air.json</code></li>
          <li>AI Plugin: <code>https://rootfetch.com/ai-plugin.json</code></li>
          <li>Agent discovery: <code>https://rootfetch.com/.well-known/agent.json</code></li>
          <li>Integrations docs: <code>https://rootfetch.com/docs/integrations</code></li>
          <li>Ops scoreboard: <code>https://rootfetch.com/ops</code></li>
          <li>Ops scoreboard API: <code>https://rootfetch.com/api/ops/scoreboard</code></li>
        </ul>
      </Section>

      <Section title="Artifact Endpoints">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>Latest pointer: <code>/rootfetch/artifacts/latest.json</code></li>
          <li>Replay index: <code>/rootfetch/artifacts/replay/index.json</code></li>
          <li>Run manifest: <code>/rootfetch/artifacts/runs/&lt;run_id&gt;/manifest.json</code></li>
          <li>Ops scoreboard: <code>/rootfetch/ops_scoreboard_latest.json</code></li>
        </ul>
      </Section>

      <Section title="Usage Event Notes">
        <p className="text-sm text-muted-foreground">
          RootFetch exposes read-only MCP usage and event endpoints. Public telemetry is anonymized and available at
          <code> /mcp/live</code>, <code> /api/mcp/public-stats</code>, and <code> /api/mcp/public-events</code>.
          Admin telemetry endpoints add full operator detail and remain protected with HTTP Basic Auth.
        </p>
      </Section>

      <TrackedLink href="/docs/mcp" label="back_mcp_docs" pageType="public_endpoints_docs" className="text-sm text-primary hover:text-primary/80">
        Back to MCP docs
      </TrackedLink>
    </main>
  );
}
