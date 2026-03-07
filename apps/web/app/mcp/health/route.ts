import { loadArtifactLatestPointer } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

export async function GET(): Promise<Response> {
  const pointer = await loadArtifactLatestPointer();
  return json({
    status: "ok",
    service: "rootfetch-mcp",
    read_only: true,
    artifact_backed: true,
    run_id: pointer?.run_id || null,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
