import { NextResponse } from "next/server";

import { loadSectorIndexRows, trimSeriesByDays } from "@/lib/rootfetch-data";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = clamp(Number(searchParams.get("days") || 90), 1, 365);
    const rows = await loadSectorIndexRows();
    const sliced = trimSeriesByDays(rows, days);
    return NextResponse.json({ days, rows: sliced });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
