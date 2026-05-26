import { loadRootfetchPublicStats } from "@/lib/public-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const payload = await loadRootfetchPublicStats();
  const siblings = {
    a2abench: {
      name: "A2ABench",
      url: "https://a2abench-api.web.app",
      stats_url: "https://a2abench-api.web.app/stats",
      stats_json_url: "https://a2abench-api.web.app/stats.json",
      agent_card_url: "https://a2abench-api.web.app/.well-known/agent.json",
    },
    ragmap: {
      name: "Ragmap",
      url: "https://ragmap-api.web.app",
      stats_url: "https://ragmap-api.web.app/stats",
      stats_json_url: "https://ragmap-api.web.app/stats.json",
      agent_card_url: "https://ragmap-api.web.app/.well-known/agent.json",
    },
  };
  return new Response(JSON.stringify({ ...payload, siblings }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
