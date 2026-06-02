import { getMcpUsageStats } from "@/lib/mcp-telemetry";
import { loadCoverage, loadLatest, loadOpsScoreboard } from "@/lib/rootfetch-data";
import { selectToolCallSuccessPct } from "@/lib/tool-call-success.mjs";

export type RootfetchPublicStats = {
  generated_at: string;
  unique_callers_7d: number;
  unique_callers_30d: number;
  mcp_calls_7d: number;
  mcp_calls_30d: number;
  tool_call_success_pct: number;
  last_run_id: string | null;
  last_run_ts: string | null;
  snapshot_freshness_hours: number | null;
  snapshot_freshness_label: string;
  tracked_tlds: number;
  observed_tlds_ever: number;
};

function parseIsoOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDateUtcOrNull(value: string | null | undefined): Date | null {
  if (!value || value === "n/a") return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatFreshnessLabel(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return "n/a";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function loadRootfetchPublicStats(): Promise<RootfetchPublicStats> {
  const [stats7, stats30, latest, coverage, ops] = await Promise.all([
    getMcpUsageStats(7),
    getMcpUsageStats(30),
    loadLatest(),
    loadCoverage(),
    loadOpsScoreboard(),
  ]);

  const now = new Date();
  const referenceNow = parseIsoOrNull(ops.reference_now_utc);
  const latestRunAgeHours = Number(ops.run_reliability.latest_run_age_hours || 0);
  const inferredLastRun =
    referenceNow && Number.isFinite(latestRunAgeHours)
      ? new Date(referenceNow.getTime() - latestRunAgeHours * 60 * 60 * 1000)
      : null;
  const fallbackRunDate = parseDateUtcOrNull(latest.date_utc);
  const lastSuccessfulRun = inferredLastRun ?? fallbackRunDate;

  const snapshotDate = parseDateUtcOrNull(coverage.date_utc || latest.date_utc);
  const snapshotFreshnessHours =
    snapshotDate != null ? Math.max(0, (now.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60)) : null;

  return {
    generated_at: now.toISOString(),
    unique_callers_7d: Number(stats7.adoption_kpi?.unique_clients || 0),
    unique_callers_30d: Number(stats30.adoption_kpi?.unique_clients || 0),
    mcp_calls_7d: Number(stats7.totals.requests || 0),
    mcp_calls_30d: Number(stats30.totals.requests || 0),
    tool_call_success_pct: selectToolCallSuccessPct(stats7, stats30),
    last_run_id: typeof latest.run_id === "string" && latest.run_id.trim().length > 0 ? latest.run_id : null,
    last_run_ts: lastSuccessfulRun ? lastSuccessfulRun.toISOString() : null,
    snapshot_freshness_hours:
      snapshotFreshnessHours == null ? null : Number(snapshotFreshnessHours.toFixed(3)),
    snapshot_freshness_label: formatFreshnessLabel(snapshotFreshnessHours),
    tracked_tlds: Number(coverage.approved_tlds_count || latest.approved_tlds_count || 0),
    observed_tlds_ever: Number(coverage.counted_ever_count || 0),
  };
}
