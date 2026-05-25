import { loadSectorIndexRows, trimSeriesByDays } from "@/lib/rootfetch-data";

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
    const days = clamp(Number(searchParams.get("days") || 90), 1, 365);
    const rows = await loadSectorIndexRows();
    const sliced = trimSeriesByDays(rows, days);
    return json({ days, rows: sliced });
  } catch {
    return json({ error: "failed" }, 500);
  }
}
