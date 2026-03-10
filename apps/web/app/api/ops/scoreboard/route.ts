import { loadOpsScoreboard } from "@/lib/rootfetch-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

function fallbackPayload() {
  return {
    generated_at_utc: new Date().toISOString(),
    reference_now_utc: new Date().toISOString(),
    run_reliability: {
      latest_run_age_hours: 0,
      runs_7d: 0,
      runs_30d: 0,
      max_gap_hours_7d: 0,
      max_gap_hours_30d: 0,
    },
    publication_cadence: {
      briefs_published_ytd: 0,
      drills_logged_ytd: 0,
    },
    adoption: {
      external_citations_logged_ytd: 0,
      adoption_log_entries_ytd: 0,
      note: "scoreboard_unavailable",
    },
    targets_90d: {
      run_completion_rate_pct: 99,
      design_partner_teams: 10,
      external_citations: 30,
      weekly_active_mcp_clients: 10,
    },
  };
}

export async function GET(_request: Request): Promise<Response> {
  try {
    const payload = await loadOpsScoreboard();
    return json(payload || fallbackPayload());
  } catch {
    return json(fallbackPayload());
  }
}
