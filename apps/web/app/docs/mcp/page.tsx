import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "MCP Usage",
  description: "How to connect MCP clients to RootFetch read-only tools and RAG search.",
  alternates: {
    canonical: "/docs/mcp",
  },
};

export default function McpDocsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="RootFetch MCP Docs" subtitle="Read-only tools over committed artifacts.">
        <p className="text-sm text-muted-foreground">
          Endpoint: <code>https://rootfetch.vercel.app/api/mcp</code>. Requires <code>Authorization: Bearer ...</code> and allowed
          origin.
        </p>
      </Section>

      <Section title="Available Tools">
        <ul className="ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li>rootfetch_get_approved_tlds</li>
          <li>rootfetch_get_coverage</li>
          <li>rootfetch_search_approved</li>
          <li>rootfetch_health</li>
          <li>rag_search</li>
          <li>rag_get_chunk</li>
        </ul>
      </Section>

      <Section title="Client Snippet">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
{`{
  "mcpServers": {
    "rootfetch": { "url": "https://rootfetch.vercel.app/api/mcp" }
  }
}`}
        </pre>
      </Section>

      <TrackedLink href="/" label="back_home_mcp_docs" pageType="mcp_docs" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
