export function selectToolCallSuccessPct(stats7, stats30) {
  const weekRequests = Number(stats7?.adoption_kpi?.tool_call_requests || 0);
  if (weekRequests > 0) {
    return Number(stats7?.adoption_kpi?.tool_call_success_rate_pct || 0);
  }

  const monthRequests = Number(stats30?.adoption_kpi?.tool_call_requests || 0);
  if (monthRequests > 0) {
    return Number(stats30?.adoption_kpi?.tool_call_success_rate_pct || 0);
  }

  return 0;
}
