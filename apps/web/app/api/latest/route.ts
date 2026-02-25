import { NextResponse } from "next/server";
import { loadLatest, loadPublishedRunBundle, parseJsonArtifact } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEmptyLatest(payload: { date_utc?: string; approved_tlds_count?: number }): boolean {
  return (payload.date_utc || "n/a") === "n/a" || Number(payload.approved_tlds_count || 0) <= 0;
}

export async function GET(request: Request) {
  try {
    const published = await loadPublishedRunBundle();
    if (published) {
      return NextResponse.json({
        ...published.signals,
        run_id: published.pointer.run_id || published.signals.run_id,
      });
    }

    const latest = await loadLatest();
    if (!isEmptyLatest(latest)) {
      return NextResponse.json(latest);
    }

    const origin = new URL(request.url).origin;
    const staticArtifact = await fetch(`${origin}/rootfetch/latest.json`, {
      cache: "no-store",
    });
    if (staticArtifact.ok) {
      const raw = await staticArtifact.text();
      return NextResponse.json(parseJsonArtifact(raw));
    }

    return NextResponse.json({ error: "latest.json missing" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_load_latest",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
