import { NextResponse } from "next/server";

import { loadOpsScoreboard } from "@/lib/rootfetch-data";

export const dynamic = "force-static";

export async function GET() {
  const payload = await loadOpsScoreboard();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
