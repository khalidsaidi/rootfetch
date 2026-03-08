import { listMcpUsageEvents } from "@/lib/mcp-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || 50)));
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

    return withCors(
      new Response(
        JSON.stringify({
          generated_at_utc: new Date().toISOString(),
          ...payload,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  } catch (error) {
    return withCors(
      new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "telemetry_unavailable",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
