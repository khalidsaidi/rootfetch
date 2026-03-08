import { createHash } from "node:crypto";

type McpEventKind =
  | "mcp_request"
  | "mcp_initialize"
  | "mcp_tools_list"
  | "mcp_tool_call"
  | "mcp_rate_limited"
  | "mcp_error";

type TelemetryMode = "shared_required" | "shared_preferred" | "local";

export type McpUsageEvent = {
  ts_utc: string;
  epoch_ms: number;
  http_method: string;
  rpc_method: string | null;
  tool_name: string | null;
  status: number;
  duration_ms: number;
  rate_limited: boolean;
  kind: McpEventKind;
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

type LocalDayStats = {
  total: number;
  rateLimited: number;
  errors: number;
  byStatus: Record<string, number>;
  byHttpMethod: Record<string, number>;
  byRpcMethod: Record<string, number>;
  byKind: Record<string, number>;
  byTool: Record<string, number>;
};

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEMETRY_EVENTS_KEY = process.env.ROOTFETCH_MCP_TELEMETRY_EVENTS_KEY || "rootfetch:mcp:events";
const TELEMETRY_STATS_KEY_PREFIX = process.env.ROOTFETCH_MCP_TELEMETRY_STATS_PREFIX || "rootfetch:mcp:stats";
const TELEMETRY_TTL_SECONDS = Math.max(86_400, Number(process.env.ROOTFETCH_MCP_TELEMETRY_TTL_SECONDS || 3_024_000));
const TELEMETRY_MAX_EVENTS = Math.max(50, Number(process.env.ROOTFETCH_MCP_TELEMETRY_MAX_EVENTS || 2000));
const LOCAL_MAX_EVENTS = Math.max(50, Number(process.env.ROOTFETCH_MCP_LOCAL_MAX_EVENTS || 1000));
const LOCAL_MAX_DAYS = Math.max(7, Number(process.env.ROOTFETCH_MCP_LOCAL_MAX_DAYS || 35));
const TELEMETRY_MODE_RAW = String(process.env.ROOTFETCH_MCP_TELEMETRY_MODE || "shared_preferred").toLowerCase();

const localEvents: McpUsageEvent[] = [];
const localDailyStats = new Map<string, LocalDayStats>();

const RECORD_EVENT_LUA = `
local eventsKey = KEYS[1]
local statsKey = KEYS[2]
local eventJson = ARGV[1]
local maxEvents = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local statusField = ARGV[4]
local httpField = ARGV[5]
local rpcField = ARGV[6]
local kindField = ARGV[7]
local toolField = ARGV[8]
local isRateLimited = tonumber(ARGV[9])
local isError = tonumber(ARGV[10])

redis.call('LPUSH', eventsKey, eventJson)
redis.call('LTRIM', eventsKey, 0, maxEvents - 1)
redis.call('EXPIRE', eventsKey, ttl)

redis.call('HINCRBY', statsKey, 'total', 1)
redis.call('HINCRBY', statsKey, statusField, 1)
redis.call('HINCRBY', statsKey, httpField, 1)
if rpcField ~= '' then redis.call('HINCRBY', statsKey, rpcField, 1) end
if kindField ~= '' then redis.call('HINCRBY', statsKey, kindField, 1) end
if toolField ~= '' then redis.call('HINCRBY', statsKey, toolField, 1) end
if isRateLimited == 1 then redis.call('HINCRBY', statsKey, 'rate_limited', 1) end
if isError == 1 then redis.call('HINCRBY', statsKey, 'errors', 1) end
redis.call('EXPIRE', statsKey, ttl)

return 1
`;

function hasSharedBackend(): boolean {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

function getTelemetryMode(): TelemetryMode {
  if (TELEMETRY_MODE_RAW === "local") return "local";
  if (TELEMETRY_MODE_RAW === "shared_preferred") return "shared_preferred";
  return "shared_required";
}

function toDateUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function makeStatsKey(dateUtc: string): string {
  return `${TELEMETRY_STATS_KEY_PREFIX}:${dateUtc}`;
}

function deriveKind(rpcMethod: string | null, rateLimited: boolean, status: number): McpEventKind {
  if (rateLimited) return "mcp_rate_limited";
  if (status >= 500) return "mcp_error";
  if (rpcMethod === "initialize") return "mcp_initialize";
  if (rpcMethod === "tools/list") return "mcp_tools_list";
  if (rpcMethod === "tools/call") return "mcp_tool_call";
  return "mcp_request";
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function hashClientIp(ip: string): string {
  const salt = process.env.ROOTFETCH_MCP_IP_HASH_SALT || "rootfetch";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
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

function parseHGetAll(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(raw)) {
    for (let idx = 0; idx + 1 < raw.length; idx += 2) {
      const key = String(raw[idx] || "");
      const value = Number(raw[idx + 1] || 0);
      if (!key) continue;
      out[key] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const num = Number(value || 0);
      out[key] = Number.isFinite(num) ? num : 0;
    }
  }
  return out;
}

function emptyDayStats(): LocalDayStats {
  return {
    total: 0,
    rateLimited: 0,
    errors: 0,
    byStatus: {},
    byHttpMethod: {},
    byRpcMethod: {},
    byKind: {},
    byTool: {},
  };
}

function trimLocalState(now: Date): void {
  while (localEvents.length > LOCAL_MAX_EVENTS) {
    localEvents.pop();
  }

  const cutoff = new Date(now.getTime() - LOCAL_MAX_DAYS * 86_400_000);
  const cutoffDate = toDateUtc(cutoff);
  for (const key of localDailyStats.keys()) {
    if (key < cutoffDate) {
      localDailyStats.delete(key);
    }
  }
}

function recordLocal(event: McpUsageEvent): void {
  localEvents.unshift(event);

  const day = event.ts_utc.slice(0, 10);
  const stats = localDailyStats.get(day) || emptyDayStats();
  stats.total += 1;
  if (event.rate_limited) stats.rateLimited += 1;
  if (event.status >= 400) stats.errors += 1;
  bump(stats.byStatus, String(event.status));
  bump(stats.byHttpMethod, event.http_method);
  if (event.rpc_method) bump(stats.byRpcMethod, event.rpc_method);
  bump(stats.byKind, event.kind);
  if (event.tool_name) bump(stats.byTool, event.tool_name);
  localDailyStats.set(day, stats);
  trimLocalState(new Date(event.epoch_ms));
}

async function upstashCommand(command: Array<string | number>): Promise<unknown> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("upstash_not_configured");
  }

  const response = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`upstash_http_${response.status}`);
  }

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(`upstash_error:${payload.error}`);
  }
  return payload.result;
}

async function recordShared(event: McpUsageEvent): Promise<void> {
  const day = event.ts_utc.slice(0, 10);
  const statsKey = makeStatsKey(day);

  const statusField = `status:${event.status}`;
  const httpField = `http:${event.http_method}`;
  const rpcField = event.rpc_method ? `rpc:${event.rpc_method}` : "";
  const kindField = event.kind ? `kind:${event.kind}` : "";
  const toolField = event.tool_name ? `tool:${event.tool_name}` : "";

  await upstashCommand([
    "EVAL",
    RECORD_EVENT_LUA,
    "2",
    TELEMETRY_EVENTS_KEY,
    statsKey,
    JSON.stringify(event),
    String(TELEMETRY_MAX_EVENTS),
    String(TELEMETRY_TTL_SECONDS),
    statusField,
    httpField,
    rpcField,
    kindField,
    toolField,
    event.rate_limited ? "1" : "0",
    event.status >= 400 ? "1" : "0",
  ]);
}

export async function recordMcpUsageEvent(input: RecordEventInput): Promise<void> {
  const event = buildEvent(input);
  const mode = getTelemetryMode();

  if (mode === "local") {
    recordLocal(event);
    return;
  }

  if (hasSharedBackend()) {
    try {
      await recordShared(event);
      return;
    } catch {
      if (mode === "shared_preferred") {
        recordLocal(event);
      }
      return;
    }
  }

  if (mode === "shared_preferred") {
    recordLocal(event);
  }
}

function blankAggregates(mode: "shared" | "local", windowDays: number): McpUsageStats {
  return {
    mode,
    generated_at_utc: new Date().toISOString(),
    window_days: windowDays,
    totals: {
      requests: 0,
      rate_limited: 0,
      errors: 0,
    },
    by_status: {},
    by_http_method: {},
    by_rpc_method: {},
    by_kind: {},
    by_tool: {},
    daily: [],
  };
}

function mergeDayRecord(target: McpUsageStats, dateUtc: string, record: Record<string, number>): void {
  const requests = Math.max(0, Number(record.total || 0));
  const rateLimited = Math.max(0, Number(record.rate_limited || 0));
  const errors = Math.max(0, Number(record.errors || 0));

  target.totals.requests += requests;
  target.totals.rate_limited += rateLimited;
  target.totals.errors += errors;

  const dayEntry = {
    date_utc: dateUtc,
    requests,
    rate_limited: rateLimited,
    errors,
  };
  target.daily.push(dayEntry);

  for (const [field, value] of Object.entries(record)) {
    if (!value || field === "total" || field === "rate_limited" || field === "errors") {
      continue;
    }
    if (field.startsWith("status:")) {
      const key = field.slice("status:".length);
      target.by_status[key] = (target.by_status[key] || 0) + value;
      continue;
    }
    if (field.startsWith("http:")) {
      const key = field.slice("http:".length);
      target.by_http_method[key] = (target.by_http_method[key] || 0) + value;
      continue;
    }
    if (field.startsWith("rpc:")) {
      const key = field.slice("rpc:".length);
      target.by_rpc_method[key] = (target.by_rpc_method[key] || 0) + value;
      continue;
    }
    if (field.startsWith("kind:")) {
      const key = field.slice("kind:".length);
      target.by_kind[key] = (target.by_kind[key] || 0) + value;
      continue;
    }
    if (field.startsWith("tool:")) {
      const key = field.slice("tool:".length);
      target.by_tool[key] = (target.by_tool[key] || 0) + value;
      continue;
    }
  }
}

function mergeLocalDayStats(target: McpUsageStats, dateUtc: string, stats: LocalDayStats): void {
  target.totals.requests += stats.total;
  target.totals.rate_limited += stats.rateLimited;
  target.totals.errors += stats.errors;

  target.daily.push({
    date_utc: dateUtc,
    requests: stats.total,
    rate_limited: stats.rateLimited,
    errors: stats.errors,
  });

  for (const [k, v] of Object.entries(stats.byStatus)) {
    target.by_status[k] = (target.by_status[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(stats.byHttpMethod)) {
    target.by_http_method[k] = (target.by_http_method[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(stats.byRpcMethod)) {
    target.by_rpc_method[k] = (target.by_rpc_method[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(stats.byKind)) {
    target.by_kind[k] = (target.by_kind[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(stats.byTool)) {
    target.by_tool[k] = (target.by_tool[k] || 0) + v;
  }
}

function windowDaysList(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86_400_000);
    out.push(toDateUtc(day));
  }
  return out;
}

export async function getMcpUsageStats(daysRaw = 7): Promise<McpUsageStats> {
  const days = Math.min(30, Math.max(1, Math.floor(daysRaw || 7)));
  const dayList = windowDaysList(days);
  const mode = getTelemetryMode();

  if (mode === "local") {
    const stats = blankAggregates("local", days);
    for (const dateUtc of dayList) {
      const local = localDailyStats.get(dateUtc) || emptyDayStats();
      mergeLocalDayStats(stats, dateUtc, local);
    }
    return stats;
  }

  if (!hasSharedBackend()) {
    if (mode === "shared_required") {
      throw new Error("telemetry_backend_not_configured");
    }
    const stats = blankAggregates("local", days);
    for (const dateUtc of dayList) {
      const local = localDailyStats.get(dateUtc) || emptyDayStats();
      mergeLocalDayStats(stats, dateUtc, local);
    }
    return stats;
  }

  try {
    const stats = blankAggregates("shared", days);
    for (const dateUtc of dayList) {
      const raw = await upstashCommand(["HGETALL", makeStatsKey(dateUtc)]);
      const parsed = parseHGetAll(raw);
      mergeDayRecord(stats, dateUtc, parsed);
    }
    return stats;
  } catch {
    if (mode === "shared_required") {
      throw new Error("telemetry_backend_unavailable");
    }
    const stats = blankAggregates("local", days);
    for (const dateUtc of dayList) {
      const local = localDailyStats.get(dateUtc) || emptyDayStats();
      mergeLocalDayStats(stats, dateUtc, local);
    }
    return stats;
  }
}

export async function listMcpUsageEvents(opts?: {
  limit?: number;
  rpcMethod?: string;
  toolName?: string;
  kind?: string;
  status?: number;
}): Promise<{ mode: "shared" | "local"; events: McpUsageEvent[] }> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit || 50)));
  const rpcMethod = opts?.rpcMethod?.trim() || "";
  const toolName = opts?.toolName?.trim() || "";
  const kind = opts?.kind?.trim() || "";
  const status = Number.isFinite(opts?.status) ? Number(opts?.status) : null;

  let events: McpUsageEvent[] = [];
  const telemetryMode = getTelemetryMode();

  if (telemetryMode === "local") {
    events = [...localEvents];
  } else if (hasSharedBackend()) {
    try {
      const raw = await upstashCommand(["LRANGE", TELEMETRY_EVENTS_KEY, "0", String(Math.max(limit * 4, limit))]);
      const rows = Array.isArray(raw) ? raw : [];
      events = rows
        .map((item) => {
          try {
            return JSON.parse(String(item)) as McpUsageEvent;
          } catch {
            return null;
          }
        })
        .filter((item): item is McpUsageEvent => Boolean(item));
    } catch {
      if (telemetryMode === "shared_required") {
        throw new Error("telemetry_backend_unavailable");
      }
      events = [...localEvents];
    }
  } else if (telemetryMode === "shared_required") {
    throw new Error("telemetry_backend_not_configured");
  } else {
    events = [...localEvents];
  }

  const mode: "shared" | "local" = telemetryMode === "local" ? "local" : hasSharedBackend() ? "shared" : "local";

  const filtered = events.filter((event) => {
    if (rpcMethod && event.rpc_method !== rpcMethod) return false;
    if (toolName && event.tool_name !== toolName) return false;
    if (kind && event.kind !== kind) return false;
    if (status !== null && event.status !== status) return false;
    return true;
  });

  return {
    mode,
    events: filtered.slice(0, limit),
  };
}
