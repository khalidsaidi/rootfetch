#!/usr/bin/env bash
set -euo pipefail

TS="${1:-$(date +%s)}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 2; }
}

require_cmd curl
require_cmd jq
require_cmd rg

fetch_body() {
  local url="$1"
  local out="$2"
  local code
  code="$(curl -sS -H 'Cache-Control: no-cache' -o "$out" -w '%{http_code}' "$url")"
  printf '%s' "$code"
}

bool_from_status() {
  if [[ "$1" == "0" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

check_stats_json() {
  local url="$1"
  shift
  local required=("$@")
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(fetch_body "$url" "$tmp")"
  local valid="false"
  local missing=""
  if jq -e . "$tmp" >/dev/null 2>&1; then
    valid="true"
    local field
    local miss=()
    for field in "${required[@]}"; do
      if ! jq -e --arg k "$field" 'has($k)' "$tmp" >/dev/null 2>&1; then
        miss+=("$field")
      fi
    done
    if [[ "${#miss[@]}" -gt 0 ]]; then
      missing="$(printf '%s,' "${miss[@]}")"
      missing="${missing%,}"
    fi
  fi
  printf '%s|%s|%s\n' "$code" "$valid" "$missing"
}

check_stats_links() {
  local host="$1"
  local base="https://${host}"
  local home_url="${base}/?cb=${TS}"
  local stats_url="${base}/stats?cb=${TS}"
  local json_url="${base}/stats.json?cb=${TS}"
  local robots_url="${base}/robots.txt"
  local sitemap_url="${base}/sitemap.xml"

  local home_body stats_body robots_body sitemap_body
  home_body="$(mktemp)"
  stats_body="$(mktemp)"
  robots_body="$(mktemp)"
  sitemap_body="$(mktemp)"

  local home_code stats_code robots_code sitemap_code
  home_code="$(fetch_body "$home_url" "$home_body")"
  stats_code="$(fetch_body "$stats_url" "$stats_body")"
  robots_code="$(fetch_body "$robots_url" "$robots_body")"
  sitemap_code="$(fetch_body "$sitemap_url" "$sitemap_body")"

  local home_loading stats_loading
  home_loading="$(rg -io '\bloading(\.\.\.|…)?\b' "$home_body" | wc -l | tr -d ' ')"
  stats_loading="$(rg -io '\bloading(\.\.\.|…)?\b' "$stats_body" | wc -l | tr -d ' ')"

  local stats_allowed sitemap_has
  stats_allowed="false"
  if rg -q '^Allow: /stats$' "$robots_body" && rg -q '^Allow: /stats\.json$' "$robots_body"; then
    stats_allowed="true"
  fi

  sitemap_has="false"
  if rg -q "<loc>${base}/stats</loc>" "$sitemap_body" && rg -q "<loc>${base}/stats.json</loc>" "$sitemap_body"; then
    sitemap_has="true"
  fi

  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$home_code" "$home_loading" "$stats_code" "$stats_loading" "$robots_code" "$stats_allowed" "$sitemap_code" "$sitemap_has" "$stats_url"

  case "$host" in
    a2abench-api.web.app)
      local req_ok="true"
      rg -Fq 'claude-haiku-4-5' "$home_body" || req_ok="false"
      rg -Fq 'gemini-2-0-flash' "$home_body" || req_ok="false"
      rg -Fq 'gemini-2-5-flash' "$home_body" || req_ok="false"
      rg -Fq 'Total submissions' "$home_body" || req_ok="false"
      rg -Fq 'Distinct external entrants' "$home_body" || req_ok="false"
      rg -Fq 'API keys issued' "$home_body" || req_ok="false"
      rg -Fq 'Feedback issues opened' "$home_body" || req_ok="false"
      rg -Fq 'href="/v1/eval/leaderboard"' "$home_body" || req_ok="false"
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || req_ok="false"
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || req_ok="false"
      printf 'a2a_required=%s\n' "$req_ok"
      ;;
    ragmap-api.web.app)
      local req_ok="true"
      rg -Fq 'href="/.well-known/agent.json"' "$home_body" || req_ok="false"
      rg -Fq 'href="/rag/stats"' "$home_body" || req_ok="false"
      rg -Fq 'href="/api/stats"' "$home_body" || req_ok="false"
      rg -Fq 'href="/stats"' "$home_body" || req_ok="false"
      rg -Fq 'href="/stats.json"' "$home_body" || req_ok="false"
      rg -Fq 'excluding bulk scrapers' "$home_body" || req_ok="false"
      rg -Fq '34.83.14.80' "$home_body" || req_ok="false"
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || req_ok="false"
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || req_ok="false"
      printf 'ragmap_required=%s\n' "$req_ok"
      ;;
    rootfetch.com)
      local req_ok="true"
      rg -Fq 'Unique callers (7d / 30d)' "$home_body" || req_ok="false"
      rg -Fq 'MCP calls (7d / 30d)' "$home_body" || req_ok="false"
      rg -Fq 'Tool-call success (7d)' "$home_body" || req_ok="false"
      rg -Fq 'Last successful run' "$home_body" || req_ok="false"
      rg -Fq 'Snapshot freshness' "$home_body" || req_ok="false"
      rg -Fq 'href="/mcp/live"' "$home_body" || req_ok="false"
      rg -Fq 'href="/ops"' "$home_body" || req_ok="false"
      rg -Fq 'href="/stats"' "$home_body" || req_ok="false"
      rg -Fq 'href="/stats.json"' "$home_body" || req_ok="false"
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || req_ok="false"
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || req_ok="false"
      printf 'rootfetch_required=%s\n' "$req_ok"
      ;;
  esac
}

report_project() {
  local project="$1"
  local host="$2"
  shift 2
  local fields=("$@")

  local line extra required_key required_val
  local host_report
  host_report="$(check_stats_links "$host")"
  line="$(printf '%s\n' "$host_report" | head -n 1)"
  extra="$(printf '%s\n' "$host_report" | tail -n 1)"
  required_key="${extra%%=*}"
  required_val="${extra##*=}"

  IFS='|' read -r home_code home_loading stats_code stats_loading robots_code stats_allowed sitemap_code sitemap_has stats_url <<<"$line"

  local json_result json_code json_valid json_missing
  json_result="$(check_stats_json "https://${host}/stats.json?cb=${TS}" "${fields[@]}")"
  IFS='|' read -r json_code json_valid json_missing <<<"$json_result"

  echo "project: ${project}"
  echo "external_gate:"
  echo "  https://${host}/?cb=${TS}            => HTTP ${home_code}, loading_count=${home_loading}, required_strings_present=${required_val}"
  echo "  https://${host}/stats?cb=${TS}       => HTTP ${stats_code}, loading_count=${stats_loading}, required_strings_present=${required_val}"
  if [[ -n "$json_missing" ]]; then
    echo "  https://${host}/stats.json?cb=${TS}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[${json_missing}]"
  else
    echo "  https://${host}/stats.json?cb=${TS}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[]"
  fi
  echo "  https://${host}/robots.txt          => stats_allowed=${stats_allowed}"
  echo "  https://${host}/sitemap.xml         => stats_in_sitemap=${sitemap_has}"

  local fail_reason=""
  [[ "$home_code" == "200" ]] || fail_reason="home_http"
  [[ "$stats_code" == "200" ]] || fail_reason="${fail_reason:-stats_http}"
  [[ "$json_code" == "200" ]] || fail_reason="${fail_reason:-json_http}"
  [[ "$home_loading" == "0" ]] || fail_reason="${fail_reason:-home_loading}"
  [[ "$stats_loading" == "0" ]] || fail_reason="${fail_reason:-stats_loading}"
  [[ "$required_val" == "true" ]] || fail_reason="${fail_reason:-required_strings}"
  [[ "$json_valid" == "true" && -z "$json_missing" ]] || fail_reason="${fail_reason:-json_fields}"
  [[ "$stats_allowed" == "true" ]] || fail_reason="${fail_reason:-robots}"
  [[ "$sitemap_has" == "true" ]] || fail_reason="${fail_reason:-sitemap}"

  if [[ -z "$fail_reason" ]]; then
    echo "verdict: PASS"
  else
    echo "verdict: FAIL (${fail_reason})"
  fi
  echo
}

report_project "a2abench" "a2abench-api.web.app" \
  submissions entrants_external keys_issued feedback_count baseline_runs last_submission_ts generated_at
report_project "ragmap" "ragmap-api.web.app" \
  servers_indexed upstream_total coverage_pct last_ingest_ts weekly_distinct_callers weekly_queries bulk_scraper_callers bulk_scraper_calls generated_at
report_project "rootfetch" "rootfetch.com" \
  unique_callers_7d unique_callers_30d mcp_calls_7d mcp_calls_30d tool_call_success_pct last_run_id last_run_ts snapshot_freshness_hours generated_at
