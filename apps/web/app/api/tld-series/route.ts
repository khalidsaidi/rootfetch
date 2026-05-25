import { loadCompareSeries, loadTldSeries } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
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
      return json({ tld: tldParam, days, rows: series });
    }

    if (tldsParam.length > 0) {
      const limited = tldsParam.slice(0, 3);
      const rows = await loadCompareSeries(limited, days);
      return json({ tlds: limited, days, rows });
    }

    return json({ error: "tld_or_tlds_required" }, 400);
  } catch {
    return json({ error: "failed" }, 500);
  }
}
