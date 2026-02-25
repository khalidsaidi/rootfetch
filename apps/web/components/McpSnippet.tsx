"use client";

import { Copy, Link2 } from "lucide-react";
import { useMemo } from "react";

import { track } from "@/lib/analytics/ga";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export default function McpSnippet({ siteUrl }: { siteUrl?: string }) {
  const origin =
    siteUrl && siteUrl.trim()
      ? normalizeBaseUrl(siteUrl)
      : typeof window !== "undefined" && window.location?.origin
        ? normalizeBaseUrl(window.location.origin)
        : "https://rootfetch.vercel.app";

  const endpoint = useMemo(() => {
    const base = origin;
    return `${base}/api/mcp`;
  }, [origin]);

  const snippet = `{
  "mcpServers": {
    "rootfetch": { "url": "${endpoint}" }
  }
}`;

  return (
    <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
      <p className="mb-2 text-xs text-muted-foreground">Connect your MCP client to the public RootFetch endpoint</p>
      <pre className="overflow-x-auto rounded-lg bg-background/80 p-3 text-xs leading-relaxed text-foreground">{snippet}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-primary/40"
          onClick={async () => {
            await navigator.clipboard.writeText(snippet);
            track("rf_copy_mcp_snippet", {});
            track("rf_mcp_snippet_copy", {});
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy snippet
        </button>
        <a
          href={endpoint}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-primary/40"
          onClick={() => {
            track("rf_mcp_doc_open", {});
            track("rf_open_mcp_endpoint", { page_type: "dashboard" });
          }}
        >
          <Link2 className="h-3.5 w-3.5" /> Open endpoint
        </a>
        <a
          href="/docs/mcp"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-primary/40"
          onClick={() => track("rf_mcp_doc_open", {})}
        >
          <Link2 className="h-3.5 w-3.5" /> Test MCP
        </a>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        MCP requires server-side token + allowed-origin checks. Browser clients should not embed tokens.
      </p>
    </div>
  );
}
