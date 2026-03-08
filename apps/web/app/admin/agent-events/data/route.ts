import { listMcpUsageEvents } from "@/lib/mcp-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return new Response(
      JSON.stringify({
        generated_at_utc: new Date().toISOString(),
        ...payload,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "telemetry_unavailable",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
