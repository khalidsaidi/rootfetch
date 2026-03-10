import { recordMcpUsageEvent } from "@/lib/mcp-telemetry";
import {
  DELETE as apiMcpDelete,
  GET as apiMcpGet,
  POST as apiMcpPost,
} from "@/app/api/mcp/route";

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

function html(payload: string, status = 200): Response {
  return new Response(payload, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
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

function makeApiMcpRequest(request: Request, rawBody?: string): Request {
  const target = new URL("/api/mcp", request.url);
  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: cloneProxyHeaders(request),
    cache: "no-store",
    redirect: "manual",
  };
  if (rawBody !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = rawBody;
  }
  return new Request(target, init);
}

async function proxyToApiMcp(request: Request, rawBody?: string): Promise<Response> {
  const method = request.method.toUpperCase();
  let response: Response;
  try {
    const apiRequest = makeApiMcpRequest(request, rawBody);
    if (method === "GET") {
      response = await apiMcpGet(apiRequest);
    } else if (method === "POST") {
      response = await apiMcpPost(apiRequest);
    } else if (method === "DELETE") {
      response = await apiMcpDelete(apiRequest);
    } else {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32601,
            message: "Method not allowed",
          },
        },
        405,
      );
    }
  } catch {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "MCP proxy failed",
        },
      },
      502,
    );
  }
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
  const payload = {
    name: "RootFetch MCP",
    status: "ok",
    protocol: "json-rpc-2.0",
    transport: "http",
    endpoint: `${origin}/mcp`,
    docs_url: "https://rootfetch.com/docs/mcp",
    openapi_url: `${origin}/openapi.json`,
    ai_plugin_url: `${origin}/ai-plugin.json`,
    health_url: `${origin}/mcp/health`,
    healthz_url: `${origin}/mcp/healthz`,
    ready_url: `${origin}/mcp/readyz`,
    hosting_page_url: `${origin}/docs/hosting/mcp/`,
    glama_connector_url: `${origin}/.well-known/glama.json`,
    npm_package: "https://www.npmjs.com/package/@khalidsaidi/rootfetch-mcp",
    usage_live_url: `${origin}/mcp/live`,
    usage_dashboard_url: `${origin}/admin/usage`,
    usage_events_dashboard_url: `${origin}/admin/agent-events`,
    usage_public_stats_url: `${origin}/api/mcp/public-stats?days=7`,
    usage_public_events_url: `${origin}/api/mcp/public-events?limit=30`,
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
  };

  const accept = (request.headers.get("accept") || "").toLowerCase();
  const reqUrl = new URL(request.url);
  const forceJson = reqUrl.searchParams.get("format") === "json";
  const wantsHtml = !forceJson && accept.includes("text/html");
  const response = wantsHtml
    ? html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RootFetch MCP</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 2rem auto; max-width: 860px; padding: 0 1rem; color: #d6e2ee; background: #020617; }
      main { border: 1px solid #1e293b; border-radius: 14px; padding: 1.25rem; background: #0b1220; }
      h1 { margin: 0 0 0.5rem; font-size: 1.6rem; }
      p, li { line-height: 1.55; color: #94a3b8; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; }
      pre { overflow: auto; border: 1px solid #1e293b; border-radius: 10px; background: #020617; padding: 0.75rem; color: #c7f9cc; }
      ul { margin: 0.5rem 0 1rem 1.25rem; }
      a { color: #67e8f9; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .grid { display: grid; gap: 0.75rem; margin-top: 1rem; }
      .card { border: 1px solid #1e293b; border-radius: 10px; padding: 0.75rem; background: #0a1426; }
      .muted { font-size: 0.9rem; color: #64748b; }
    </style>
  </head>
  <body>
    <main>
      <h1>RootFetch MCP</h1>
      <p>Public, read-only MCP endpoint backed by immutable RootFetch artifacts.</p>
      <div class="grid">
        <div class="card">
          <strong>Endpoint</strong>
          <pre>${payload.endpoint}</pre>
          <p class="muted">JSON metadata: <a href="${payload.endpoint}?format=json">${payload.endpoint}?format=json</a></p>
        </div>
        <div class="card">
          <strong>Docs + Live Usage</strong>
          <ul>
            <li><a href="${payload.docs_url}">${payload.docs_url}</a></li>
            <li><a href="${payload.usage_live_url}">${payload.usage_live_url}</a></li>
            <li><a href="${payload.openapi_url}">${payload.openapi_url}</a></li>
            <li><a href="${payload.hosting_page_url}">${payload.hosting_page_url}</a></li>
          </ul>
        </div>
        <div class="card">
          <strong>Health</strong>
          <ul>
            <li><a href="${payload.health_url}">${payload.health_url}</a></li>
            <li><a href="${payload.healthz_url}">${payload.healthz_url}</a></li>
            <li><a href="${payload.ready_url}">${payload.ready_url}</a></li>
          </ul>
        </div>
        <div class="card">
          <strong>Install</strong>
          <pre>{ "mcpServers": { "rootfetch": { "url": "${payload.endpoint}" } } }</pre>
          <p class="muted">Local bridge: <code>npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp</code></p>
          <p class="muted">Package: <a href="${payload.npm_package}">${payload.npm_package}</a></p>
        </div>
      </div>
      <p class="muted">No key required. Responses are artifact-backed only. No server-side recompute.</p>
    </main>
  </body>
</html>`)
    : json(payload);
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
