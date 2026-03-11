import type { Metadata } from "next";
import Script from "next/script";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "MCP Docs",
  description: "How to connect MCP clients to RootFetch read-only artifact tools.",
  alternates: {
    canonical: "/docs/mcp",
  },
};

export default function McpDocsPage() {
  const initializeExample = `curl -sS https://rootfetch.com/mcp \\
  -X POST \\
  -H 'content-type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1.0.0"}}}'`;

  const toolsListExample = `curl -sS https://rootfetch.com/mcp \\
  -X POST \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'`;

  const toolCallExample = `curl -sS https://rootfetch.com/mcp \\
  -X POST \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rootfetch.latest","arguments":{}}}'`;

  const sseFrameExample = `event: message
data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{...json...}"}]}}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="RootFetch MCP Docs" subtitle="Read-only tools over committed artifacts.">
        <p className="text-sm text-muted-foreground">
          Endpoint: <code>https://rootfetch.com/mcp</code>. Public and rate-limited. Responses are artifact-backed only (no
          server-side recompute).
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Agent quickstart: <code>https://rootfetch.com/agents</code>. First-call validator:{" "}
          <code>https://rootfetch.com/api/mcp/first-call</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Live probe endpoint (initialize + tools/list + outcome tool call):{" "}
          <code>https://rootfetch.com/api/mcp/probe</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Interactive MCP playground: <code>https://rootfetch.com/agents/playground</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Task recipes page: <code>https://rootfetch.com/agents/recipes</code>. Machine-readable recipes:
          <code> https://rootfetch.com/api/mcp/task-recipes</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Browser-friendly MCP landing page: <code>https://rootfetch.com/mcp</code>. Raw metadata:{" "}
          <code>https://rootfetch.com/mcp?format=json</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Hosting compatibility page: <code>https://rootfetch.com/docs/hosting/mcp/</code>.
          Glama connector: <code>https://rootfetch.com/.well-known/glama.json</code>.
        </p>
      </Section>

      <Section title="Install Options">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>Direct remote endpoint (recommended): <code>https://rootfetch.com/mcp</code></li>
          <li>NPM stdio bridge: <code>npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp</code></li>
          <li>Package: <code>https://www.npmjs.com/package/@khalidsaidi/rootfetch-mcp</code></li>
        </ul>
      </Section>

      <Section title="Tool Surface">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li><code>rootfetch.outcome.current_state</code>: strict state summary + mandatory evidence.</li>
          <li><code>rootfetch.outcome.run_delta</code> (<code>left_run_id?</code>, <code>right_run_id?</code>): strict run deltas + disclosure.</li>
          <li><code>rootfetch.outcome.tld_spotlight</code> (<code>tld</code>, <code>run_id?</code>): strict TLD outcome row + evidence.</li>
          <li><code>rootfetch.outcome.alert_candidates</code> (<code>run_id?</code>, <code>limit?</code>): strict candidate rows + trigger context.</li>
          <li><code>rootfetch.latest</code>: latest pointer + run-scoped artifact URLs.</li>
          <li><code>rootfetch.replay_index</code>: immutable replay index.</li>
          <li><code>rootfetch.run_manifest</code> (<code>run_id?</code>): manifest + hash/check counts.</li>
          <li><code>rootfetch.run_bundle</code> (<code>run_id?</code>): model + coverage + signals for one run.</li>
          <li><code>rootfetch.compare_link</code> (<code>left</code>, <code>right</code>): compare URL only.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Machine-readable outcome contracts: <code>/api/mcp/outcome-schemas</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Task-oriented tool recipes: <code>/api/mcp/task-recipes</code>.
        </p>
      </Section>

      <Section title="Calling Pattern">
        <p className="text-sm text-muted-foreground">
          MCP uses JSON-RPC 2.0. <code>initialize</code> returns JSON. <code>tools/list</code> and <code>tools/call</code> may
          return stream frames; set <code>Accept: application/json, text/event-stream</code>.
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Initialize</p>
        <pre className="mt-2 overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {initializeExample}
        </pre>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">List tools</p>
        <pre className="mt-2 overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {toolsListExample}
        </pre>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Call tool</p>
        <pre className="mt-2 overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {toolCallExample}
        </pre>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Stream frame example</p>
        <pre className="mt-2 overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
          {sseFrameExample}
        </pre>
      </Section>

      <Section title="Operations">
        <p className="text-sm text-muted-foreground">
          Default policy: 60 requests/minute per IP with burst capacity of 20. Exceeded requests return <code>429</code> with
          <code>Retry-After</code>. Responses include <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, and
          <code>X-RateLimit-Mode</code>. No key is required.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Health: <code>GET https://rootfetch.com/mcp/health</code></li>
          <li>Healthz: <code>GET https://rootfetch.com/mcp/healthz</code></li>
          <li>Readiness: <code>GET https://rootfetch.com/mcp/readyz</code></li>
        </ul>
        <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>MCP is read-only and artifact-backed.</li>
          <li>MCP does not compute new signals.</li>
          <li>Tool responses are size-bounded.</li>
        </ul>
      </Section>

      <Section title="Usage Events">
        <p className="text-sm text-muted-foreground">
          RootFetch now exposes MCP usage visibility endpoints for operational monitoring:
          <code> /api/mcp/stats</code> and <code>/api/mcp/events</code>. These telemetry endpoints and the usage dashboard are
          admin-protected via HTTP Basic Auth.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Public anonymized visibility is available at <code>/mcp/live</code>, backed by{" "}
          <code>/api/mcp/public-stats</code> and <code>/api/mcp/public-events</code>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Stats now include adoption KPIs (<code>unique_clients</code>, <code>repeat_clients</code>, and
          <code>tool_call_success_rate_pct</code>) for weekly integration tracking.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Usage telemetry is persisted through a dedicated backend service (Cloud Run + Firestore), so stats/events remain
          durable across instances and deploys.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          MCP remains read-only over immutable artifacts. 
          Page-level analytics events (for example <code>rf_mcp_doc_open</code> and <code>rf_copy_mcp_snippet</code>) are
          still tracked separately.
        </p>
        <TrackedLink
          href="/agents"
          label="mcp_docs_agents"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open agent integration
        </TrackedLink>
        <TrackedLink
          href="/agents/playground"
          label="mcp_docs_playground"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open MCP playground
        </TrackedLink>
        <TrackedLink
          href="/agents/recipes"
          label="mcp_docs_agent_recipes"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open task recipes
        </TrackedLink>
        <TrackedLink
          href="/mcp/live"
          label="mcp_docs_public_live_usage"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open public live usage
        </TrackedLink>
        <TrackedLink
          href="/admin/usage"
          label="mcp_docs_usage_dashboard"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open MCP usage dashboard
        </TrackedLink>
        <TrackedLink
          href="/admin/agent-events"
          label="mcp_docs_agent_events_dashboard"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          Open MCP agent events
        </TrackedLink>
        <TrackedLink
          href="/docs/public-endpoints"
          label="mcp_docs_public_endpoints"
          pageType="mcp_docs"
          className="mt-3 inline-flex text-sm text-primary hover:text-primary/80"
        >
          View canonical public endpoints
        </TrackedLink>
      </Section>

      <Section title="Client Snippet">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
{`{
  "mcpServers": {
    "rootfetch": { "url": "https://rootfetch.com/mcp" }
  }
}`}
        </pre>
      </Section>

      <Section title="Agentability">
        <div data-agentability-domain="rootfetch.com" data-agentability-style="card"></div>
        <Script src="https://agentability.org/embed/widget.js" async />
      </Section>

      <TrackedLink href="/" label="back_home_mcp_docs" pageType="mcp_docs" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
