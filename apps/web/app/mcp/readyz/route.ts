import { loadArtifactLatestPointer, loadRunBundleById } from "@/lib/rootfetch-data";

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
  const runId = String(pointer?.run_id || "").trim();
  if (!runId) {
    return json(
      {
        status: "not_ready",
        reason: "latest_pointer_missing",
      },
      503,
    );
  }

  const bundle = await loadRunBundleById(runId);
  if (!bundle) {
    return json(
      {
        status: "not_ready",
        reason: "run_bundle_missing",
        run_id: runId,
      },
      503,
    );
  }

  return json({
    status: "ready",
    run_id: runId,
    expected_count: bundle.expectedCount,
    checked_count: bundle.checkedCount,
    missing_files: bundle.missingPaths.length,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
