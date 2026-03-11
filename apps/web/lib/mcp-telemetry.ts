import { createHash } from "node:crypto";

export type McpUsageEvent = {
  ts_utc: string;
  epoch_ms: number;
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

export type McpUsageStats = {
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
};

type RecordEventInput = {
  now?: Date;
  httpMethod: string;
  rpcMethod?: string | null;
  toolName?: string | null;
  status: number;
  durationMs: number;
  rateLimited: boolean;
  limiterMode: "shared" | "local";
  clientIp?: string;
};

const BACKEND_URL = String(process.env.ROOTFETCH_MCP_TELEMETRY_BACKEND_URL || "").trim().replace(/\/$/, "");
const BACKEND_TOKEN = String(process.env.ROOTFETCH_MCP_TELEMETRY_BACKEND_TOKEN || process.env.ROOTFETCH_MCP_TOKEN || "").trim();
const LOCAL_EVENT_CAP = Math.max(200, Number(process.env.ROOTFETCH_MCP_LOCAL_EVENT_CAP || 2000));
const localEvents: McpUsageEvent[] = [];

function hasBackendConfig(): boolean {
  return Boolean(BACKEND_URL && BACKEND_TOKEN);
}

export function hasMcpTelemetryBackend(): boolean {
  return hasBackendConfig();
}

function requireBackendConfig(): void {
  if (!hasBackendConfig()) {
    throw new Error("telemetry_backend_not_configured");
  }
}

function hashClientIp(ip: string): string {
  const salt = process.env.ROOTFETCH_MCP_IP_HASH_SALT || "rootfetch";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

function deriveKind(rpcMethod: string | null, rateLimited: boolean, status: number): string {
  if (rateLimited) return "mcp_rate_limited";
  if (status >= 500) return "mcp_error";
  if (rpcMethod === "initialize") return "mcp_initialize";
  if (rpcMethod === "tools/list") return "mcp_tools_list";
  if (rpcMethod === "tools/call") return "mcp_tool_call";
  return "mcp_request";
}

function dateUtcFromEpochMs(epochMs: number): string {
  const safe = Number.isFinite(epochMs) ? epochMs : Date.now();
  return new Date(safe).toISOString().slice(0, 10);
}

function pushLocalEvent(event: McpUsageEvent): void {
  localEvents.push(event);
  if (localEvents.length > LOCAL_EVENT_CAP) {
    localEvents.splice(0, localEvents.length - LOCAL_EVENT_CAP);
  }
}

function daysWindowStartEpochMs(days: number): number {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
}

function listLocalEvents(opts?: {
  limit?: number;
  rpcMethod?: string;
  toolName?: string;
  kind?: string;
  status?: number;
}): McpUsageEvent[] {
  const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit || 50)));
  const rows = [...localEvents].sort((a, b) => b.epoch_ms - a.epoch_ms);
  const filtered: McpUsageEvent[] = [];
  for (const row of rows) {
    if (opts?.rpcMethod && row.rpc_method !== opts.rpcMethod) continue;
    if (opts?.toolName && row.tool_name !== opts.toolName) continue;
    if (opts?.kind && row.kind !== opts.kind) continue;
    if (Number.isFinite(opts?.status) && row.status !== opts?.status) continue;
    filtered.push(row);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

function computeStatsFromEvents(events: McpUsageEvent[], days: number): McpUsageStats {
  const startEpochMs = daysWindowStartEpochMs(days);
  const rows = events.filter((row) => row.epoch_ms >= startEpochMs);

  const totals = { requests: 0, rate_limited: 0, errors: 0 };
  const by_status: Record<string, number> = {};
  const by_http_method: Record<string, number> = {};
  const by_rpc_method: Record<string, number> = {};
  const by_kind: Record<string, number> = {};
  const by_tool: Record<string, number> = {};
  const dailyMap = new Map<string, { requests: number; rate_limited: number; errors: number }>();

  const ipCounts = new Map<string, number>();
  let toolCallRequests = 0;
  let toolCallSuccess = 0;
  let initializeRequests = 0;

  const bump = (target: Record<string, number>, key: string | null) => {
    if (!key) return;
    target[key] = (target[key] || 0) + 1;
  };

  for (const row of rows) {
    totals.requests += 1;
    if (row.rate_limited) totals.rate_limited += 1;
    if (row.status >= 400) totals.errors += 1;

    if (row.rpc_method === "tools/call") {
      toolCallRequests += 1;
      if (row.status < 400) toolCallSuccess += 1;
    }
    if (row.rpc_method === "initialize") {
      initializeRequests += 1;
    }

    ipCounts.set(row.ip_hash, (ipCounts.get(row.ip_hash) || 0) + 1);

    bump(by_status, String(row.status));
    bump(by_http_method, row.http_method || null);
    bump(by_rpc_method, row.rpc_method || null);
    bump(by_kind, row.kind || null);
    bump(by_tool, row.tool_name || null);

    const dateUtc = dateUtcFromEpochMs(row.epoch_ms);
    const slot = dailyMap.get(dateUtc) || { requests: 0, rate_limited: 0, errors: 0 };
    slot.requests += 1;
    if (row.rate_limited) slot.rate_limited += 1;
    if (row.status >= 400) slot.errors += 1;
    dailyMap.set(dateUtc, slot);
  }

  const daily: Array<{ date_utc: string; requests: number; rate_limited: number; errors: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - offset);
    const dateUtc = day.toISOString().slice(0, 10);
    const slot = dailyMap.get(dateUtc) || { requests: 0, rate_limited: 0, errors: 0 };
    daily.push({
      date_utc: dateUtc,
      requests: slot.requests,
      rate_limited: slot.rate_limited,
      errors: slot.errors,
    });
  }

  const uniqueClients = ipCounts.size;
  const repeatClients = Array.from(ipCounts.values()).filter((count) => count >= 2).length;
  const repeatClientRatePct = uniqueClients > 0 ? (repeatClients / uniqueClients) * 100 : 0;
  const toolCallSuccessRatePct = toolCallRequests > 0 ? (toolCallSuccess / toolCallRequests) * 100 : 0;

  return {
    mode: "local",
    generated_at_utc: new Date().toISOString(),
    window_days: days,
    totals,
    by_status,
    by_http_method,
    by_rpc_method,
    by_kind,
    by_tool,
    adoption_kpi: {
      unique_clients: uniqueClients,
      repeat_clients: repeatClients,
      repeat_client_rate_pct: Number(repeatClientRatePct.toFixed(3)),
      tool_call_requests: toolCallRequests,
      tool_call_success_rate_pct: Number(toolCallSuccessRatePct.toFixed(3)),
      initialize_requests: initializeRequests,
      weekly_active_clients_proxy: days <= 7 ? uniqueClients : null,
    },
    daily,
  };
}

function buildEvent(input: RecordEventInput): McpUsageEvent {
  const now = input.now || new Date();
  const rpcMethod = input.rpcMethod ? String(input.rpcMethod) : null;
  const toolName = input.toolName ? String(input.toolName) : null;
  const status = Number.isFinite(input.status) ? Number(input.status) : 0;
  const durationMs = Math.max(0, Math.round(input.durationMs || 0));
  const ipHash = hashClientIp((input.clientIp || "unknown").trim() || "unknown");

  return {
    ts_utc: now.toISOString(),
    epoch_ms: now.getTime(),
    http_method: input.httpMethod.toUpperCase(),
    rpc_method: rpcMethod,
    tool_name: toolName,
    status,
    duration_ms: durationMs,
    rate_limited: Boolean(input.rateLimited),
    kind: deriveKind(rpcMethod, Boolean(input.rateLimited), status),
    limiter_mode: input.limiterMode,
    ip_hash: ipHash,
  };
}

async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  requireBackendConfig();
  const url = `${BACKEND_URL}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${BACKEND_TOKEN}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
  return response;
}

export async function recordMcpUsageEvent(input: RecordEventInput): Promise<void> {
  const event = buildEvent(input);
  pushLocalEvent(event);
  if (!hasBackendConfig()) {
    return;
  }
  try {
    const response = await backendFetch("/ingest", {
      method: "POST",
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      return;
    }
  } catch {
    return;
  }
}

function normalizeStats(payload: unknown, days: number): McpUsageStats {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Partial<McpUsageStats>;
  return {
    mode: raw.mode === "local" ? "local" : "shared",
    generated_at_utc: String(raw.generated_at_utc || new Date().toISOString()),
    window_days: Number.isFinite(raw.window_days) ? Number(raw.window_days) : days,
    totals: {
      requests: Number(raw.totals?.requests || 0),
      rate_limited: Number(raw.totals?.rate_limited || 0),
      errors: Number(raw.totals?.errors || 0),
    },
    by_status: (raw.by_status || {}) as Record<string, number>,
    by_http_method: (raw.by_http_method || {}) as Record<string, number>,
    by_rpc_method: (raw.by_rpc_method || {}) as Record<string, number>,
    by_kind: (raw.by_kind || {}) as Record<string, number>,
    by_tool: (raw.by_tool || {}) as Record<string, number>,
    adoption_kpi:
      raw.adoption_kpi && typeof raw.adoption_kpi === "object"
        ? {
            unique_clients: Number((raw.adoption_kpi as { unique_clients?: number }).unique_clients || 0),
            repeat_clients: Number((raw.adoption_kpi as { repeat_clients?: number }).repeat_clients || 0),
            repeat_client_rate_pct: Number(
              (raw.adoption_kpi as { repeat_client_rate_pct?: number }).repeat_client_rate_pct || 0,
            ),
            tool_call_requests: Number((raw.adoption_kpi as { tool_call_requests?: number }).tool_call_requests || 0),
            tool_call_success_rate_pct: Number(
              (raw.adoption_kpi as { tool_call_success_rate_pct?: number }).tool_call_success_rate_pct || 0,
            ),
            initialize_requests: Number((raw.adoption_kpi as { initialize_requests?: number }).initialize_requests || 0),
            weekly_active_clients_proxy:
              (raw.adoption_kpi as { weekly_active_clients_proxy?: number | null }).weekly_active_clients_proxy ?? null,
          }
        : undefined,
    daily: Array.isArray(raw.daily) ? raw.daily : [],
  };
}

export async function getMcpUsageStats(daysRaw = 7): Promise<McpUsageStats> {
  const days = Math.min(30, Math.max(1, Math.floor(daysRaw || 7)));
  if (hasBackendConfig()) {
    try {
      const response = await backendFetch(`/stats?days=${encodeURIComponent(String(days))}`);
      if (!response.ok) {
        throw new Error(`telemetry_backend_http_${response.status}`);
      }
      const payload = (await response.json()) as unknown;
      return normalizeStats(payload, days);
    } catch {
      return computeStatsFromEvents(localEvents, days);
    }
  }
  return computeStatsFromEvents(localEvents, days);
}

export async function listMcpUsageEvents(opts?: {
  limit?: number;
  rpcMethod?: string;
  toolName?: string;
  kind?: string;
  status?: number;
}): Promise<{ mode: "shared" | "local"; events: McpUsageEvent[] }> {
  const params = new URLSearchParams();
  const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit || 50)));
  params.set("limit", String(limit));
  if (opts?.rpcMethod) params.set("rpc_method", opts.rpcMethod);
  if (opts?.toolName) params.set("tool_name", opts.toolName);
  if (opts?.kind) params.set("kind", opts.kind);
  if (Number.isFinite(opts?.status)) params.set("status", String(opts?.status));

  if (hasBackendConfig()) {
    try {
      const response = await backendFetch(`/events?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`telemetry_backend_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        mode?: "shared" | "local";
        events?: McpUsageEvent[];
      };

      const out: McpUsageEvent[] = Array.isArray(payload?.events) ? payload.events : [];
      return {
        mode: payload?.mode === "local" ? "local" : "shared",
        events: out,
      };
    } catch {
      return {
        mode: "local",
        events: listLocalEvents(opts),
      };
    }
  }
  return {
    mode: "local",
    events: listLocalEvents(opts),
  };
}
