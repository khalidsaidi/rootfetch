import { getMcpUsageStats, hasMcpTelemetryBackend } from "@/lib/mcp-telemetry";

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

function emptyStats(days: number, backend: "local" | "error", note: string) {
  return {
    mode: "local" as const,
    generated_at_utc: new Date().toISOString(),
    window_days: days,
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
    adoption_kpi: {
      unique_clients: 0,
      repeat_clients: 0,
      repeat_client_rate_pct: 0,
      tool_call_requests: 0,
      tool_call_success_rate_pct: 0,
      initialize_requests: 0,
      weekly_active_clients_proxy: 0,
    },
    daily: [],
    backend,
    note,
  };
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days") || 7)));

  try {
    const stats = await getMcpUsageStats(days);
    const backend = hasMcpTelemetryBackend() ? "configured" : "local";
    const note =
      backend === "local"
        ? "Telemetry is running in local in-process mode for this deployment."
        : null;
    return withCors(
      new Response(
        JSON.stringify({
          ...stats,
          backend,
          note,
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
          emptyStats(days, "error", "Telemetry is temporarily unavailable."),
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
