"use client";

import { useEffect, useState } from "react";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

type AgentEvent = {
  ts_utc: string;
  http_method: string;
  rpc_method: string | null;
  tool_name: string | null;
  status: number;
  duration_ms: number;
  rate_limited: boolean;
  kind: string;
  limiter_mode: "shared" | "local";
  ip_hash: string;
};

type EventsPayload = {
  generated_at_utc: string;
  mode: "shared" | "local";
  events: AgentEvent[];
};

export default function AdminAgentEventsPage() {
  const [limit, setLimit] = useState(50);
  const [rpcMethod, setRpcMethod] = useState("");
  const [toolName, setToolName] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<EventsPayload>({
    generated_at_utc: "",
    mode: "local",
    events: [],
  });

  async function loadEvents() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (rpcMethod.trim()) params.set("rpc_method", rpcMethod.trim());
      if (toolName.trim()) params.set("tool_name", toolName.trim());
      if (kind.trim()) params.set("kind", kind.trim());
      if (status.trim()) params.set("status", status.trim());

      const response = await fetch(`/admin/agent-events/data?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Events request failed (${response.status})`);
      }

      const next = (await response.json()) as EventsPayload;
      setPayload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="MCP Agent Events" subtitle="Recent MCP event log (admin view).">
        <div className="flex flex-wrap items-end gap-3 text-sm text-muted-foreground">
          <label className="inline-flex flex-col gap-1">
            <span>Limit</span>
            <input
              value={limit}
              onChange={(event) => setLimit(Math.min(200, Math.max(1, Number(event.target.value) || 50)))}
              type="number"
              min={1}
              max={200}
              className="w-24 rounded-md border border-border/70 bg-background/70 px-2 py-1"
            />
          </label>

          <label className="inline-flex flex-col gap-1">
            <span>RPC method</span>
            <input
              value={rpcMethod}
              onChange={(event) => setRpcMethod(event.target.value)}
              placeholder="tools/call"
              className="w-44 rounded-md border border-border/70 bg-background/70 px-2 py-1"
            />
          </label>

          <label className="inline-flex flex-col gap-1">
            <span>Tool</span>
            <input
              value={toolName}
              onChange={(event) => setToolName(event.target.value)}
              placeholder="rootfetch.latest"
              className="w-48 rounded-md border border-border/70 bg-background/70 px-2 py-1"
            />
          </label>

          <label className="inline-flex flex-col gap-1">
            <span>Kind</span>
            <input
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              placeholder="mcp_tool_call"
              className="w-40 rounded-md border border-border/70 bg-background/70 px-2 py-1"
            />
          </label>

          <label className="inline-flex flex-col gap-1">
            <span>Status</span>
            <input
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder="200"
              className="w-20 rounded-md border border-border/70 bg-background/70 px-2 py-1"
            />
          </label>

          <button
            type="button"
            onClick={() => void loadEvents()}
            className="rounded-md border border-border/70 bg-background/70 px-3 py-1 hover:border-primary/50"
          >
            Load events
          </button>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          Mode: <code>{payload.mode}</code> · Generated: <code>{payload.generated_at_utc || "-"}</code>
        </p>
        {loading ? <p className="mt-2 text-sm text-muted-foreground">Loading events...</p> : null}
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      </Section>

      <Section title="Events">
        <div className="space-y-3">
          {payload.events.length ? (
            payload.events.map((event) => (
              <div
                key={`${event.ts_utc}:${event.ip_hash}:${event.kind}:${event.status}:${event.tool_name ?? "none"}`}
                className="rounded-lg border border-border/70 bg-background/70 p-4 text-sm text-muted-foreground"
              >
                <div className="mb-2 flex flex-wrap gap-3 text-xs">
                  <span><code>{event.ts_utc}</code></span>
                  <span><code>{event.kind}</code></span>
                  <span><code>{event.http_method}</code></span>
                  <span><code>{event.rpc_method || "-"}</code></span>
                  <span><code>{event.tool_name || "-"}</code></span>
                  <span>Status: <code>{event.status}</code></span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <span>Duration: <code>{event.duration_ms} ms</code></span>
                  <span>Rate limited: <code>{event.rate_limited ? "yes" : "no"}</code></span>
                  <span>Client hash: <code>{event.ip_hash}</code></span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          )}
        </div>
      </Section>

      <div className="flex flex-wrap gap-4">
        <TrackedLink href="/admin/usage" label="admin_agent_events_usage" pageType="mcp_admin_events" className="text-sm text-primary hover:text-primary/80">
          Open usage dashboard
        </TrackedLink>
        <TrackedLink href="/admin/alerts" label="admin_agent_events_alerts" pageType="mcp_admin_events" className="text-sm text-primary hover:text-primary/80">
          Open alert simulator
        </TrackedLink>
        <TrackedLink href="/docs/mcp" label="admin_agent_events_docs" pageType="mcp_admin_events" className="text-sm text-primary hover:text-primary/80">
          Back to MCP docs
        </TrackedLink>
      </div>
    </main>
  );
}
