import { getAgentTaskRecipeCatalog } from "@/lib/agent-task-recipes";

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

export async function GET(): Promise<Response> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";
  return withCors(
    new Response(JSON.stringify(getAgentTaskRecipeCatalog(siteUrl)), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }),
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
