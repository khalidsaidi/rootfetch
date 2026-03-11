import { hasMcpTelemetryBackend, listMcpUsageEvents } from "@/lib/mcp-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

function withCors(response: Response): Response {
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

function emptyEvents(backend: "local" | "error", note: string) {
  return {
    generated_at_utc: new Date().toISOString(),
    mode: "local" as const,
    backend,
    note,
    events: [] as Array<{
      ts_utc: string;
      http_method: string;
      rpc_method: string | null;
      tool_name: string | null;
      status: number;
      duration_ms: number;
      rate_limited: boolean;
      kind: string;
      limiter_mode: "shared" | "local";
    }>,
  };
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 30)));
  const rpcMethod = searchParams.get("rpc_method") || undefined;
  const toolName = searchParams.get("tool_name") || undefined;
  const kind = searchParams.get("kind") || undefined;
  const statusRaw = searchParams.get("status");
  const status = statusRaw ? Number(statusRaw) : undefined;

  try {
    const payload = await listMcpUsageEvents({
      limit,
      rpcMethod,
      toolName,
      kind,
      status: Number.isFinite(status) ? status : undefined,
    });

    const redacted = payload.events.map((event) => ({
      ts_utc: event.ts_utc,
      http_method: event.http_method,
      rpc_method: event.rpc_method,
      tool_name: event.tool_name,
      status: event.status,
      duration_ms: event.duration_ms,
      rate_limited: event.rate_limited,
      kind: event.kind,
      limiter_mode: event.limiter_mode,
    }));

    return withCors(
      new Response(
        JSON.stringify({
          generated_at_utc: new Date().toISOString(),
          mode: payload.mode,
          backend: hasMcpTelemetryBackend() ? "configured" : "local",
          note: hasMcpTelemetryBackend() ? null : "Telemetry is running in local in-process mode for this deployment.",
          events: redacted,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  } catch {
    return withCors(
      new Response(
        JSON.stringify(
          emptyEvents("error", "Telemetry is temporarily unavailable."),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
