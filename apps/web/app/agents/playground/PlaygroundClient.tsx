"use client";

import { useMemo, useState } from "react";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

type JsonRpcEnvelope = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type ToolTemplate = {
  args: Record<string, unknown>;
  hint: string;
};

const TOOLS = [
  "rootfetch.outcome.current_state",
  "rootfetch.outcome.run_delta",
  "rootfetch.outcome.tld_spotlight",
  "rootfetch.outcome.alert_candidates",
  "rootfetch.latest",
  "rootfetch.replay_index",
  "rootfetch.run_manifest",
  "rootfetch.run_bundle",
  "rootfetch.compare_link",
];

const TOOL_TEMPLATES: Record<string, ToolTemplate> = {
  "rootfetch.outcome.current_state": {
    args: {},
    hint: "Current run snapshot with regime, concentration, coverage, and evidence block.",
  },
  "rootfetch.outcome.run_delta": {
    args: {},
    hint: "Latest run vs previous run with model transition disclosure checks.",
  },
  "rootfetch.outcome.tld_spotlight": {
    args: { tld: "app" },
    hint: "Single-namespace view. Change tld to any delegated TLD label.",
  },
  "rootfetch.outcome.alert_candidates": {
    args: { limit: 10 },
    hint: "Top anomaly and mover candidates with trigger context.",
  },
  "rootfetch.latest": {
    args: {},
    hint: "Latest immutable run pointer and scoped artifact URLs.",
  },
  "rootfetch.replay_index": {
    args: {},
    hint: "Run lineage from replay index.",
  },
  "rootfetch.run_manifest": {
    args: {},
    hint: "Run hash/check summary (optional run_id).",
  },
  "rootfetch.run_bundle": {
    args: {},
    hint: "Model + coverage + signals bundle for one run (optional run_id).",
  },
  "rootfetch.compare_link": {
    args: {
      left: "20260226T090051Z_f229c6bb7bba_rootfetch_model_v1",
      right: "20260307T231738Z_8a3bde89bd87_rootfetch_model_v1",
    },
    hint: "Compare URL helper. Replace left/right with explicit run_ids.",
  },
};

function parseSsePayload(raw: string): JsonRpcEnvelope | null {
  let parsed: JsonRpcEnvelope | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      parsed = JSON.parse(data) as JsonRpcEnvelope;
    } catch {
      // ignore non-json frames
    }
  }
  return parsed;
}

export default function PlaygroundClient() {
  const [toolName, setToolName] = useState<string>(TOOLS[0]);
  const [argsJson, setArgsJson] = useState<string>(
    JSON.stringify(TOOL_TEMPLATES[TOOLS[0]]?.args || {}, null, 2),
  );
  const [responseText, setResponseText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const initializePayload = useMemo(
    () => ({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "rootfetch-playground",
          version: "1.0.0",
        },
      },
    }),
    [],
  );

  const selectedHint = TOOL_TEMPLATES[toolName]?.hint || "Calls the selected MCP tool.";

  async function callTool() {
    setLoading(true);
    setError("");
    setResponseText("");
    try {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(argsJson) as Record<string, unknown>;
      } catch {
        throw new Error("Arguments JSON is invalid.");
      }

      const commonHeaders = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };

      const initResp = await fetch("/mcp", {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(initializePayload),
      });
      if (!initResp.ok) {
        throw new Error(`Initialize failed (${initResp.status}).`);
      }

      const callPayload = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: parsedArgs,
        },
      };

      const callResp = await fetch("/mcp", {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(callPayload),
      });
      const raw = await callResp.text();
      if (!callResp.ok) {
        throw new Error(`Tool call failed (${callResp.status}): ${raw.slice(0, 300)}`);
      }

      const contentType = String(callResp.headers.get("content-type") || "").toLowerCase();
      let envelope: JsonRpcEnvelope | null = null;
      if (contentType.includes("text/event-stream")) {
        envelope = parseSsePayload(raw);
      } else {
        envelope = JSON.parse(raw) as JsonRpcEnvelope;
      }
      if (!envelope) {
        throw new Error("Unable to parse MCP response.");
      }

      setResponseText(JSON.stringify(envelope, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool call failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-all">
      <Section title="Agent Playground" subtitle="Interactive MCP calls for non-CLI users.">
        <p className="text-sm text-muted-foreground">
          This page runs <code>initialize</code> then <code>tools/call</code> against <code>/mcp</code> and prints the
          raw response envelope.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <TrackedLink href="/agents" label="playground_back_agents" pageType="agents_playground" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Back to agents guide
          </TrackedLink>
          <TrackedLink href="/api/mcp/outcome-schemas" label="playground_open_outcome_schemas" pageType="agents_playground" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Outcome schemas JSON
          </TrackedLink>
          <TrackedLink href="/api/mcp/first-call" label="playground_open_first_call" pageType="agents_playground" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            First-call validator
          </TrackedLink>
          <TrackedLink href="/agents/recipes" label="playground_open_recipes_page" pageType="agents_playground" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Task recipes page
          </TrackedLink>
          <TrackedLink href="/api/mcp/task-recipes" label="playground_open_recipes_json" pageType="agents_playground" className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50">
            Task recipes JSON
          </TrackedLink>
        </div>
      </Section>

      <Section title="Call Tool" subtitle="Choose a tool and provide JSON arguments.">
        <div className="grid gap-4 md:grid-cols-[300px,1fr]">
          <label className="flex flex-col gap-2 text-sm text-muted-foreground">
            Tool
            <select
              value={toolName}
              onChange={(event) => {
                const nextTool = event.target.value;
                setToolName(nextTool);
                const template = TOOL_TEMPLATES[nextTool];
                setArgsJson(JSON.stringify(template?.args || {}, null, 2));
              }}
              className="rounded-md border border-border/70 bg-background/70 px-2 py-2 text-sm"
            >
              {TOOLS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted-foreground">
            Arguments JSON
            <textarea
              value={argsJson}
              onChange={(event) => setArgsJson(event.target.value)}
              rows={8}
              className="rf-mono-digits rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{selectedHint}</p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void callTool()}
            disabled={loading}
            className="rounded-md border border-border/70 bg-background/70 px-3 py-1.5 text-sm hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Calling..." : "Call MCP tool"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </Section>

      <Section title="Response" subtitle="Raw JSON-RPC envelope (copyable).">
        {responseText ? (
          <pre className="rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{responseText}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">No response yet.</p>
        )}
      </Section>
    </main>
  );
}
