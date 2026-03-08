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

function hasBackendConfig(): boolean {
  return Boolean(BACKEND_URL && BACKEND_TOKEN);
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
  if (!hasBackendConfig()) {
    return;
  }

  const event = buildEvent(input);
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
    daily: Array.isArray(raw.daily) ? raw.daily : [],
  };
}

export async function getMcpUsageStats(daysRaw = 7): Promise<McpUsageStats> {
  const days = Math.min(30, Math.max(1, Math.floor(daysRaw || 7)));
  const response = await backendFetch(`/stats?days=${encodeURIComponent(String(days))}`);
  if (!response.ok) {
    throw new Error(`telemetry_backend_http_${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return normalizeStats(payload, days);
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
}
