import { NextResponse } from "next/server";

import { loadCompareSeries, loadTldSeries } from "@/lib/rootfetch-data";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tldParam = (searchParams.get("tld") || "").trim().toLowerCase();
    const tldsParam = (searchParams.get("tlds") || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const days = clamp(Number(searchParams.get("days") || 90), 1, 365);

    if (tldParam) {
      const series = await loadTldSeries(tldParam, days);
      return NextResponse.json({ tld: tldParam, days, rows: series });
    }

    if (tldsParam.length > 0) {
      const limited = tldsParam.slice(0, 3);
      const rows = await loadCompareSeries(limited, days);
      return NextResponse.json({ tlds: limited, days, rows });
    }

    return NextResponse.json({ error: "tld_or_tlds_required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
