import { buildCurrentStateOutcome } from "@/lib/mcp-outcomes";
import { loadArtifactLatestPointer, loadRunBundleById } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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

function json(payload: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const origin = resolveOrigin(request);
  const pointer = await loadArtifactLatestPointer();
  if (!pointer?.run_id) {
    return json(
      {
        generated_at_utc: new Date().toISOString(),
        endpoint: `${origin}/mcp`,
        checks: {
          latest_pointer_present: false,
          run_bundle_present: false,
          manifest_complete: false,
          ready: false,
        },
        error: "latest_run_unavailable",
      },
      503,
    );
  }

  const runId = String(pointer.run_id);
  const bundle = await loadRunBundleById(runId);
  if (!bundle) {
    return json(
      {
        generated_at_utc: new Date().toISOString(),
        endpoint: `${origin}/mcp`,
        run_id: runId,
        checks: {
          latest_pointer_present: true,
          run_bundle_present: false,
          manifest_complete: false,
          ready: false,
        },
        error: "latest_run_bundle_unavailable",
      },
      503,
    );
  }

  const manifestComplete = bundle.expectedCount === bundle.checkedCount && bundle.missingPaths.length === 0;
  const sampleOutcome = buildCurrentStateOutcome(runId, bundle);

  return json({
    generated_at_utc: new Date().toISOString(),
    endpoint: `${origin}/mcp`,
    run_id: runId,
    checks: {
      latest_pointer_present: true,
      run_bundle_present: true,
      manifest_complete: manifestComplete,
      ready: manifestComplete,
    },
    initialize_request: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "first-call-check",
          version: "1.0.0",
        },
      },
    },
    tool_call_request: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "rootfetch.outcome.current_state",
        arguments: { run_id: runId },
      },
    },
    expected_response_keys: [
      "outcome",
      "schema_version",
      "run_id",
      "regime",
      "concentration",
      "coverage",
      "volatility",
      "evidence",
    ],
    sample_outcome: sampleOutcome,
    evidence_required: true,
    docs_url: `${origin}/agents`,
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

