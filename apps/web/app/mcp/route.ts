import { recordMcpUsageEvent } from "@/lib/mcp-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

type JsonRpcId = string | number | null;

type JsonRpcInitializeRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: {
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    clientInfo?: Record<string, unknown>;
  };
};

function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function resolvePublicOrigin(request: Request): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return new URL(request.url).origin;
}

function cloneProxyHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const accept = headers.get("accept") || "";
  if (!accept.toLowerCase().includes("text/event-stream")) {
    const merged = accept
      ? `${accept}, text/event-stream`
      : "application/json, text/event-stream";
    headers.set("accept", merged);
  }
  return headers;
}

async function proxyToApiMcp(request: Request, rawBody?: string): Promise<Response> {
  const target = new URL("/api/mcp", request.url);
  const response = await fetch(target, {
    method: request.method,
    headers: cloneProxyHeaders(request),
    body: rawBody,
    cache: "no-store",
    redirect: "manual",
  });

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function initializeResponse(id: JsonRpcId): Response {
  return json({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "rootfetch-mcp",
        version: "1.0.0",
      },
      capabilities: {
        tools: {
          listChanged: false,
        },
        resources: {
          subscribe: false,
          listChanged: false,
        },
      },
      instructions:
        "Read-only artifact-backed MCP endpoint. Responses are derived from immutable run artifacts only (no server-side recompute).",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const origin = resolvePublicOrigin(request);
  const response = json({
    name: "RootFetch MCP",
    status: "ok",
    protocol: "json-rpc-2.0",
    transport: "http",
    endpoint: `${origin}/mcp`,
    docs_url: "https://rootfetch.com/docs/mcp",
    openapi_url: `${origin}/openapi.json`,
    ai_plugin_url: `${origin}/ai-plugin.json`,
    health_url: `${origin}/mcp/health`,
    ready_url: `${origin}/mcp/readyz`,
    usage_dashboard_url: `${origin}/mcp/usage`,
    usage_stats_url: `${origin}/api/mcp/stats?days=7`,
    usage_events_url: `${origin}/api/mcp/events?limit=50`,
    capabilities: ["tools/list", "tools/call"],
    tools: [
      "rootfetch.latest",
      "rootfetch.replay_index",
      "rootfetch.run_manifest",
      "rootfetch.run_bundle",
      "rootfetch.compare_link",
    ],
    artifact_backed: true,
    read_only: true,
    no_recompute: true,
  });
  await recordMcpUsageEvent({
    httpMethod: "GET",
    status: response.status,
    durationMs: Date.now() - startedAt,
    rateLimited: false,
    limiterMode: "local",
    clientIp: extractClientIp(request),
  });
  return response;
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const clientIp = extractClientIp(request);
  const rawBody = await request.text();

  let payload: JsonRpcInitializeRequest | null = null;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as JsonRpcInitializeRequest) : null;
  } catch {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
        },
      },
      400,
    );
  }

  if (!payload || typeof payload !== "object") {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request",
        },
      },
      400,
    );
  }

  const requestPayload: JsonRpcInitializeRequest = payload;

  if (requestPayload.method === "initialize") {
    const id: JsonRpcId = requestPayload.id ?? null;
    const response = initializeResponse(id);
    await recordMcpUsageEvent({
      httpMethod: "POST",
      rpcMethod: "initialize",
      status: response.status,
      durationMs: Date.now() - startedAt,
      rateLimited: false,
      limiterMode: "local",
      clientIp,
    });
    return response;
  }

  return proxyToApiMcp(request, rawBody);
}

export async function DELETE(request: Request): Promise<Response> {
  return proxyToApiMcp(request);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
