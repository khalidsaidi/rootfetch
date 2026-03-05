import type { Metadata } from "next";
import Script from "next/script";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "MCP Usage",
  description: "How to connect MCP clients to RootFetch read-only artifact tools.",
  alternates: {
    canonical: "/docs/mcp",
  },
};

export default function McpDocsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="RootFetch MCP Docs" subtitle="Read-only tools over committed artifacts.">
        <p className="text-sm text-muted-foreground">
          Endpoint: <code>https://rootfetch.com/mcp</code>. Public and rate-limited. Responses are artifact-backed only (no
          server-side recompute).
        </p>
      </Section>

      <Section title="Available Tools">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>rootfetch.latest</li>
          <li>rootfetch.replay_index</li>
          <li>rootfetch.run_manifest</li>
          <li>rootfetch.run_bundle</li>
          <li>rootfetch.compare_link</li>
        </ul>
      </Section>

      <Section title="Rate Limit">
        <p className="text-sm text-muted-foreground">
          Default policy: 60 requests/minute per IP with burst capacity of 20. Exceeded requests return <code>429</code> with
          <code>Retry-After</code>. No key is required.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Optional: configure <code>UPSTASH_REDIS_REST_URL</code> + <code>UPSTASH_REDIS_REST_TOKEN</code> for shared,
          cross-instance limiting. Without Upstash, a built-in per-instance limiter is used.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>MCP is read-only and artifact-backed.</li>
          <li>MCP does not compute new signals.</li>
          <li>Tool responses are size-bounded.</li>
        </ul>
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
