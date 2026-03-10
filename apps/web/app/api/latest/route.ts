import { loadLatest, loadPublishedRunBundle, parseJsonArtifact } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isEmptyLatest(payload: { date_utc?: string; approved_tlds_count?: number }): boolean {
  return (payload.date_utc || "n/a") === "n/a" || Number(payload.approved_tlds_count || 0) <= 0;
}

function resolvePublicOrigin(request: Request): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestProto = new URL(request.url).protocol.replace(":", "");
  if (forwardedHost) {
    return `${forwardedProto || requestProto || "https"}://${forwardedHost}`;
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const published = await loadPublishedRunBundle();
    if (published) {
      return jsonResponse({
        ...published.signals,
        run_id: published.pointer.run_id || published.signals.run_id,
      });
    }

    const latest = await loadLatest();
    if (!isEmptyLatest(latest)) {
      return jsonResponse(latest);
    }

    const origin = resolvePublicOrigin(request);
    const staticArtifact = await fetch(`${origin}/rootfetch/latest.json`, {
      cache: "no-store",
    });
    if (staticArtifact.ok) {
      const raw = await staticArtifact.text();
      return jsonResponse(parseJsonArtifact(raw));
    }

    return jsonResponse({ error: "latest.json missing" }, 404);
  } catch (error) {
    return jsonResponse(
      {
        error: "failed_to_load_latest",
        message: error instanceof Error ? error.message : "unknown error",
      },
      500,
    );
  }
}
