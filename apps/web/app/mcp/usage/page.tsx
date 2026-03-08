"use client";

import { useEffect, useMemo, useState } from "react";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

type UsageStats = {
  mode: "shared" | "local";
  generated_at_utc: string;
  window_days: number;
  totals: {
    requests: number;
    rate_limited: number;
    errors: number;
  };
  by_status: Record<string, number>;
  by_http_method: Record<string, number>;
  by_rpc_method: Record<string, number>;
  by_kind: Record<string, number>;
  by_tool: Record<string, number>;
  daily: Array<{
    date_utc: string;
    requests: number;
    rate_limited: number;
    errors: number;
  }>;
};

type UsageEventsPayload = {
  generated_at_utc: string;
  mode: "shared" | "local";
  events: Array<{
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
  }>;
};

const emptyStats: UsageStats = {
  mode: "local",
  generated_at_utc: "",
  window_days: 7,
  totals: { requests: 0, rate_limited: 0, errors: 0 },
  by_status: {},
  by_http_method: {},
  by_rpc_method: {},
  by_kind: {},
  by_tool: {},
  daily: [],
};

function orderedEntries(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

export default function McpUsagePage() {
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<UsageStats>(emptyStats);
  const [eventsPayload, setEventsPayload] = useState<UsageEventsPayload>({
    generated_at_utc: "",
    mode: "local",
    events: [],
  });

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [statsResponse, eventsResponse] = await Promise.all([
        fetch(`/api/mcp/stats?days=${encodeURIComponent(String(days))}`, { cache: "no-store" }),
        fetch(`/api/mcp/events?limit=${encodeURIComponent(String(limit))}`, { cache: "no-store" }),
      ]);

      if (!statsResponse.ok) {
        throw new Error(`Stats request failed (${statsResponse.status})`);
      }
      if (!eventsResponse.ok) {
        throw new Error(`Events request failed (${eventsResponse.status})`);
      }

      const nextStats = (await statsResponse.json()) as UsageStats;
      const nextEvents = (await eventsResponse.json()) as UsageEventsPayload;
      setStats(nextStats);
      setEventsPayload(nextEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP usage data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, limit]);

  const topTools = useMemo(() => orderedEntries(stats.by_tool).slice(0, 15), [stats.by_tool]);
  const topRpc = useMemo(() => orderedEntries(stats.by_rpc_method), [stats.by_rpc_method]);
  const topStatuses = useMemo(() => orderedEntries(stats.by_status), [stats.by_status]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="MCP Usage" subtitle="Live usage and event visibility for RootFetch MCP.">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <label className="inline-flex items-center gap-2">
            <span>Window</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-md border border-border/70 bg-background/70 px-2 py-1"
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-2">
            <span>Recent events</span>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="rounded-md border border-border/70 bg-background/70 px-2 py-1"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-md border border-border/70 bg-background/70 px-3 py-1 hover:border-primary/50"
          >
            Refresh
          </button>

          <span>Mode: <code>{stats.mode}</code></span>
          <span>Generated: <code>{stats.generated_at_utc || eventsPayload.generated_at_utc || "-"}</code></span>
        </div>

        {stats.mode === "local" ? (
          <p className="mt-3 text-xs text-amber-300">
            Local mode stores telemetry per runtime instance.
          </p>
        ) : null}

        {loading ? <p className="mt-3 text-sm text-muted-foreground">Loading usage data...</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </Section>

      <Section title="Totals">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Requests</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totals.requests}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Rate Limited</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totals.rate_limited}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Errors (4xx/5xx)</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totals.errors}</p>
          </div>
        </div>
      </Section>

      <Section title="Breakdown">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">By RPC Method</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {topRpc.length ? topRpc.map(([key, value]) => <li key={key}><code>{key}</code>: {value}</li>) : <li>none</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">By Status</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {topStatuses.length ? topStatuses.map(([key, value]) => <li key={key}><code>{key}</code>: {value}</li>) : <li>none</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Top Tools</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {topTools.length ? topTools.map(([key, value]) => <li key={key}><code>{key}</code>: {value}</li>) : <li>none</li>}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Daily Series">
        <div className="overflow-auto rounded-lg border border-border/70 bg-background/70">
          <table className="w-full min-w-[560px] text-left text-sm text-muted-foreground">
            <thead>
              <tr className="border-b border-border/70">
                <th className="px-3 py-2">Date (UTC)</th>
                <th className="px-3 py-2">Requests</th>
                <th className="px-3 py-2">Rate limited</th>
                <th className="px-3 py-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {stats.daily.map((row) => (
                <tr key={row.date_utc} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-2"><code>{row.date_utc}</code></td>
                  <td className="px-3 py-2">{row.requests}</td>
                  <td className="px-3 py-2">{row.rate_limited}</td>
                  <td className="px-3 py-2">{row.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent Events">
        <div className="overflow-auto rounded-lg border border-border/70 bg-background/70">
          <table className="w-full min-w-[980px] text-left text-xs text-muted-foreground">
            <thead>
              <tr className="border-b border-border/70">
                <th className="px-3 py-2">Timestamp (UTC)</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">HTTP</th>
                <th className="px-3 py-2">RPC</th>
                <th className="px-3 py-2">Tool</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Duration ms</th>
                <th className="px-3 py-2">Rate limited</th>
                <th className="px-3 py-2">Client hash</th>
              </tr>
            </thead>
            <tbody>
              {eventsPayload.events.map((event) => (
                <tr key={`${event.ts_utc}:${event.ip_hash}:${event.kind}:${event.status}`} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-2"><code>{event.ts_utc}</code></td>
                  <td className="px-3 py-2"><code>{event.kind}</code></td>
                  <td className="px-3 py-2"><code>{event.http_method}</code></td>
                  <td className="px-3 py-2"><code>{event.rpc_method || "-"}</code></td>
                  <td className="px-3 py-2"><code>{event.tool_name || "-"}</code></td>
                  <td className="px-3 py-2">{event.status}</td>
                  <td className="px-3 py-2">{event.duration_ms}</td>
                  <td className="px-3 py-2">{event.rate_limited ? "yes" : "no"}</td>
                  <td className="px-3 py-2"><code>{event.ip_hash}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="API Endpoints">
        <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li><code>/api/mcp/stats?days=7</code></li>
          <li><code>/api/mcp/events?limit=50</code></li>
          <li><code>/api/mcp/events?rpc_method=tools/call&amp;tool_name=rootfetch.latest</code></li>
        </ul>
      </Section>

      <TrackedLink href="/docs/mcp" label="mcp_usage_back_docs" pageType="mcp_usage" className="text-sm text-primary hover:text-primary/80">
        Back to MCP docs
      </TrackedLink>
      <TrackedLink href="/admin/agent-events" label="mcp_usage_agent_events" pageType="mcp_usage" className="text-sm text-primary hover:text-primary/80">
        Open agent events view
      </TrackedLink>
    </main>
  );
}
