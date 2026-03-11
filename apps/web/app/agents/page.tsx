import type { Metadata } from "next";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

const initCurl = `curl -sS ${siteUrl}/mcp \\
  -X POST \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example-agent","version":"1.0.0"}}}'`;

const firstCallCurl = `curl -sS ${siteUrl}/mcp \\
  -X POST \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rootfetch.outcome.current_state","arguments":{}}}'`;

const mcpConfigSnippet = `{
  "mcpServers": {
    "rootfetch": {
      "url": "${siteUrl}/mcp"
    }
  }
}`;

const strictContract = `Rules:
1) Treat tool responses as authoritative only when "evidence" is present.
2) Persist run_id + manifest_sha256 with any downstream claim.
3) If model_version changes between runs, require explicit disclosure.
4) Do not infer structural shift from cross-model compares without disclosure.`;

export const metadata: Metadata = {
  title: "Agent Integration",
  description: "Outcome-first RootFetch integration path for agents: strict schemas, first-call validation, and evidence discipline.",
  alternates: {
    canonical: "/agents",
  },
};

export default function AgentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-all">
      <Section title="Agent Integration" subtitle="Outcome-first MCP usage over immutable RootFetch artifacts.">
        <p className="text-sm text-muted-foreground">
          RootFetch is read-only. Agents should call outcome tools, persist evidence fields, and avoid narrative output
          not anchored to immutable runs.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <TrackedLink href="/docs/mcp" label="agents_open_mcp_docs" pageType="agents" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            MCP docs
          </TrackedLink>
          <TrackedLink href="/api/mcp/first-call" label="agents_open_first_call" pageType="agents" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            First-call validator
          </TrackedLink>
          <TrackedLink href="/mcp/live" label="agents_open_live_usage" pageType="agents" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Live usage
          </TrackedLink>
        </div>
      </Section>

      <Section title="1) Connect" subtitle="Remote MCP endpoint (recommended).">
        <pre className="rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{mcpConfigSnippet}</pre>
        <div className="mt-2">
          <CopyValueButton value={mcpConfigSnippet} keyName="agents_mcp_config" context="agents_page" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Local bridge option: <code>npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp</code>
        </p>
      </Section>

      <Section title="2) First-Call Validation" subtitle="Initialize, call one outcome tool, and verify response keys.">
        <p className="text-sm text-muted-foreground">
          Use <code>/api/mcp/first-call</code> for a live bootstrap payload with expected request/response structure.
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Initialize</p>
        <pre className="mt-2 rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{initCurl}</pre>
        <div className="mt-2">
          <CopyValueButton value={initCurl} keyName="agents_init_curl" context="agents_page" />
        </div>

        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Current state outcome</p>
        <pre className="mt-2 rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{firstCallCurl}</pre>
        <div className="mt-2">
          <CopyValueButton value={firstCallCurl} keyName="agents_first_call_curl" context="agents_page" />
        </div>
      </Section>

      <Section title="3) Outcome Tools (Strict)" subtitle="Use these before raw tools for operational workflows.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground"><code>rootfetch.outcome.current_state</code></p>
            <p className="mt-1">Current run: regime, DVI, concentration, coverage, top anomalies, mandatory evidence.</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground"><code>rootfetch.outcome.run_delta</code></p>
            <p className="mt-1">Run pair deltas with model-version disclosure and compare/evidence links.</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground"><code>rootfetch.outcome.tld_spotlight</code></p>
            <p className="mt-1">TLD-focused count/share/delta/anomaly flags for one run + evidence anchors.</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground"><code>rootfetch.outcome.alert_candidates</code></p>
            <p className="mt-1">Candidate anomaly/mover rows with trigger context and immutable evidence.</p>
          </div>
        </div>
      </Section>

      <Section title="4) Evidence Is Mandatory" subtitle="No evidence block means no publishable claim.">
        <pre className="rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{strictContract}</pre>
      </Section>

      <Section title="5) Telemetry and Adoption KPIs" subtitle="Monitor agent usage and first-call health.">
        <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>Public stats: <code>/api/mcp/public-stats?days=7</code></li>
          <li>Public events: <code>/api/mcp/public-events?limit=30</code></li>
          <li>Public dashboard: <code>/mcp/live</code></li>
          <li>Admin usage: <code>/admin/usage</code></li>
          <li>Admin events: <code>/admin/agent-events</code></li>
        </ul>
      </Section>
    </main>
  );
}

