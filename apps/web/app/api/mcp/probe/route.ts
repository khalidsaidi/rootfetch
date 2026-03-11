export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function resolveOrigin(request: Request): string {
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

function parseSsePayload(raw: string): unknown {
  let parsed: unknown = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      parsed = JSON.parse(data);
    } catch {
      // ignore non-json frames
    }
  }
  return parsed;
}

async function postRpc(origin: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await response.text();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();

  let body: unknown = null;
  if (contentType.includes("text/event-stream")) {
    body = parseSsePayload(text);
  } else {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

export async function POST(request: Request): Promise<Response> {
  const origin = resolveOrigin(request);
  const started = Date.now();
  try {
    const initialize = await postRpc(origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "mcp-live-probe",
          version: "1.0.0",
        },
      },
    });

    const toolsList = await postRpc(origin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const outcome = await postRpc(origin, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "rootfetch.outcome.current_state",
        arguments: {},
      },
    });

    return withCors(
      new Response(
        JSON.stringify({
          ok: initialize.status === 200 && toolsList.status === 200 && outcome.status === 200,
          generated_at_utc: new Date().toISOString(),
          duration_ms: Date.now() - started,
          statuses: {
            initialize: initialize.status,
            tools_list: toolsList.status,
            current_state: outcome.status,
          },
          endpoint: `${origin}/mcp`,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
  } catch (error) {
    return withCors(
      new Response(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "probe_failed",
          generated_at_utc: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

