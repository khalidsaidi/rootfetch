"use client";

import { useEffect, useMemo, useState } from "react";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

type PublicStats = {
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
  adoption_kpi?: {
    unique_clients: number;
    repeat_clients: number;
    repeat_client_rate_pct: number;
    tool_call_requests: number;
    tool_call_success_rate_pct: number;
    initialize_requests: number;
    weekly_active_clients_proxy?: number | null;
  };
  daily: Array<{
    date_utc: string;
    requests: number;
    rate_limited: number;
    errors: number;
  }>;
  backend?: "configured" | "local" | "error";
  note?: string | null;
};

type PublicEvents = {
  generated_at_utc: string;
  mode: "shared" | "local";
  backend?: "configured" | "local" | "error";
  note?: string | null;
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
  }>;
};

const EMPTY_STATS: PublicStats = {
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
  backend: "local",
  note: "No usage data yet.",
};

const EMPTY_EVENTS: PublicEvents = {
  generated_at_utc: "",
  mode: "local",
  backend: "local",
  note: "No usage events yet.",
  events: [],
};

function ordered(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function statusTone(backend: PublicStats["backend"]): string {
  if (backend === "configured") return "text-emerald-300";
  if (backend === "error") return "text-amber-300";
  return "text-muted-foreground";
}

export default function McpLiveClient() {
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<PublicStats>(EMPTY_STATS);
  const [eventsPayload, setEventsPayload] = useState<PublicEvents>(EMPTY_EVENTS);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [statsRes, eventsRes] = await Promise.all([
        fetch(`/api/mcp/public-stats?days=${encodeURIComponent(String(days))}`, { cache: "no-store" }),
        fetch(`/api/mcp/public-events?limit=${encodeURIComponent(String(limit))}`, { cache: "no-store" }),
      ]);

      if (!statsRes.ok) throw new Error(`Public stats failed (${statsRes.status})`);
      if (!eventsRes.ok) throw new Error(`Public events failed (${eventsRes.status})`);

      const nextStats = (await statsRes.json()) as PublicStats;
      const nextEvents = (await eventsRes.json()) as PublicEvents;
      setStats(nextStats);
      setEventsPayload(nextEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load MCP live data.");
    } finally {
      setLoading(false);
    }
  }

  async function runProbe() {
    setProbeLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(`Probe failed (${response.status})`);
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe failed.");
    } finally {
      setProbeLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, limit]);

  const topTool = useMemo(() => ordered(stats.by_tool)[0], [stats.by_tool]);
  const topRpc = useMemo(() => ordered(stats.by_rpc_method)[0], [stats.by_rpc_method]);
  const adoption = stats.adoption_kpi;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="MCP Live Activity" subtitle="Public usage visibility for the RootFetch MCP endpoint.">
        <p className="text-sm text-muted-foreground">
          This page is anonymized and read-only. It shows aggregate request behavior and recent event classes without
          exposing client identities.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
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
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-md border border-border/70 bg-background/70 px-3 py-1 hover:border-primary/50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={probeLoading}
            className="rounded-md border border-border/70 bg-background/70 px-3 py-1 hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {probeLoading ? "Probing..." : "Run probe"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Backend:{" "}
            <code className={statusTone(stats.backend)}>{stats.backend || "unknown"}</code>
          </span>
          <span>Mode: <code>{stats.mode}</code></span>
          <span>Generated: <code>{stats.generated_at_utc || eventsPayload.generated_at_utc || "-"}</code></span>
        </div>
        {stats.note ? <p className="mt-2 text-xs text-amber-300">{stats.note}</p> : null}
        {eventsPayload.note ? <p className="mt-2 text-xs text-amber-300">{eventsPayload.note}</p> : null}
        {loading ? <p className="mt-2 text-sm text-muted-foreground">Loading...</p> : null}
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      </Section>

      <Section title="Summary">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Requests</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totals.requests}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Rate limited</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totals.rate_limited}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Top RPC method</p>
            <p className="mt-1 text-sm font-semibold">
              {topRpc ? <><code>{topRpc[0]}</code> ({topRpc[1]})</> : "none"}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Top tool</p>
            <p className="mt-1 text-sm font-semibold">
              {topTool ? <><code>{topTool[0]}</code> ({topTool[1]})</> : "none"}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Adoption KPIs (Public)">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Unique clients</p>
            <p className="mt-1 text-2xl font-semibold">{adoption?.unique_clients ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Repeat clients</p>
            <p className="mt-1 text-2xl font-semibold">{adoption?.repeat_clients ?? 0}</p>
            <p className="text-xs text-muted-foreground">rate: {(adoption?.repeat_client_rate_pct ?? 0).toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Tool-call success</p>
            <p className="mt-1 text-2xl font-semibold">{(adoption?.tool_call_success_rate_pct ?? 0).toFixed(2)}%</p>
            <p className="text-xs text-muted-foreground">calls: {adoption?.tool_call_requests ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Initialize requests</p>
            <p className="mt-1 text-2xl font-semibold">{adoption?.initialize_requests ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              weekly active proxy: {adoption?.weekly_active_clients_proxy ?? 0}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Daily Requests">
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
              {stats.daily.length ? (
                stats.daily.map((row) => (
                  <tr key={row.date_utc} className="border-b border-border/30 last:border-b-0">
                    <td className="px-3 py-2"><code>{row.date_utc}</code></td>
                    <td className="px-3 py-2">{row.requests}</td>
                    <td className="px-3 py-2">{row.rate_limited}</td>
                    <td className="px-3 py-2">{row.errors}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-3 text-sm text-muted-foreground" colSpan={4}>No request history yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent Event Classes">
        <div className="overflow-auto rounded-lg border border-border/70 bg-background/70">
          <table className="w-full min-w-[860px] text-left text-xs text-muted-foreground">
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
              </tr>
            </thead>
            <tbody>
              {eventsPayload.events.length ? (
                eventsPayload.events.map((event) => (
                  <tr key={`${event.ts_utc}:${event.kind}:${event.status}:${event.tool_name || "none"}`} className="border-b border-border/30 last:border-b-0">
                    <td className="px-3 py-2"><code>{event.ts_utc}</code></td>
                    <td className="px-3 py-2"><code>{event.kind}</code></td>
                    <td className="px-3 py-2"><code>{event.http_method}</code></td>
                    <td className="px-3 py-2"><code>{event.rpc_method || "-"}</code></td>
                    <td className="px-3 py-2"><code>{event.tool_name || "-"}</code></td>
                    <td className="px-3 py-2">{event.status}</td>
                    <td className="px-3 py-2">{event.duration_ms}</td>
                    <td className="px-3 py-2">{event.rate_limited ? "yes" : "no"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-3 text-sm text-muted-foreground" colSpan={8}>No recent events.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Full Operations Views">
        <div className="flex flex-wrap gap-3 text-sm">
          <TrackedLink href="/docs/mcp" label="mcp_live_docs" pageType="mcp_live" className="rounded-md border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            MCP docs
          </TrackedLink>
          <TrackedLink href="/admin/usage" label="mcp_live_admin_usage" pageType="mcp_live" className="rounded-md border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Admin usage
          </TrackedLink>
          <TrackedLink href="/admin/agent-events" label="mcp_live_admin_events" pageType="mcp_live" className="rounded-md border border-border/70 bg-background/70 px-3 py-1.5 hover:border-primary/50">
            Admin events
          </TrackedLink>
        </div>
      </Section>
    </main>
  );
}
