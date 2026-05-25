#!/usr/bin/env bash
set -euo pipefail

TS="${1:-$(date +%s)}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 2; }
}

require_cmd curl
require_cmd jq
require_cmd rg

fetch_with_meta() {
  local url="$1"
  local out="$2"
  curl -sS -L -H 'Cache-Control: no-cache' -o "$out" -w '%{http_code}|%{url_effective}' "$url"
}

append_cb() {
  local url="$1"
  if [[ "$url" == *"cb="* ]]; then
    printf '%s' "$url"
    return
  fi
  if [[ "$url" == *"?"* ]]; then
    printf '%s&cb=%s' "$url" "$TS"
  else
    printf '%s?cb=%s' "$url" "$TS"
  fi
}

resolve_href() {
  local base="$1"
  local href="$2"
  href="${href%%#*}"
  [[ -z "$href" ]] && return
  case "$href" in
    mailto:*|tel:*|javascript:*) return ;;
    http://*|https://*) printf '%s\n' "$href" ;;
    //*) printf 'https:%s\n' "$href" ;;
    /*) printf '%s%s\n' "$base" "$href" ;;
    *) printf '%s/%s\n' "$base" "$href" ;;
  esac
}

extract_links() {
  local base="$1"
  local file="$2"
  rg -o 'href=["'"'"'][^"'"'"']+["'"'"']' "$file" \
    | sed -E 's/^href=["'"'"'](.*)["'"'"']$/\1/' \
    | while IFS= read -r href; do resolve_href "$base" "$href"; done \
    | rg -v '^$' \
    | sort -u
}

expects_json() {
  local url="$1"
  case "$url" in
    */stats.json*|*/api/stats*|*/rag/stats*|*/v1/eval/leaderboard*) return 0 ;;
    *) return 1 ;;
  esac
}

check_required_strings() {
  local host="$1"
  local home_body="$2"
  case "$host" in
    a2abench-api.web.app)
      rg -Fq 'claude-haiku-4-5' "$home_body" || return 1
      rg -Fq 'gemini-2-0-flash' "$home_body" || return 1
      rg -Fq 'gemini-2-5-flash' "$home_body" || return 1
      rg -Fq 'Total submissions' "$home_body" || return 1
      rg -Fq 'Distinct external entrants' "$home_body" || return 1
      rg -Fq 'API keys issued' "$home_body" || return 1
      rg -Fq 'Feedback issues opened' "$home_body" || return 1
      rg -Fq 'href="/v1/eval/leaderboard"' "$home_body" || return 1
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || return 1
      ;;
    ragmap-api.web.app)
      rg -Fq 'href="/.well-known/agent.json"' "$home_body" || return 1
      rg -Fq 'href="/rag/stats"' "$home_body" || return 1
      rg -Fq 'href="/api/stats"' "$home_body" || return 1
      rg -Fq 'href="/stats"' "$home_body" || return 1
      rg -Fq 'href="/stats.json"' "$home_body" || return 1
      rg -Fq 'excluding bulk scrapers (e.g. 34.83.14.80)' "$home_body" || return 1
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || return 1
      ;;
    rootfetch.com)
      rg -Fq 'Unique callers (7d / 30d)' "$home_body" || return 1
      rg -Fq 'MCP calls (7d / 30d)' "$home_body" || return 1
      rg -Fq 'Tool-call success (7d)' "$home_body" || return 1
      rg -Fq 'Last successful run' "$home_body" || return 1
      rg -Fq 'Snapshot freshness' "$home_body" || return 1
      rg -Fq 'href="/mcp/live"' "$home_body" || return 1
      rg -Fq 'href="/ops"' "$home_body" || return 1
      rg -Fq 'href="/stats"' "$home_body" || return 1
      rg -Fq 'href="/stats.json"' "$home_body" || return 1
      rg -Fq 'DVI (live run)' "$home_body" || return 1
      rg -Fq 'DVI (replay window)' "$home_body" || return 1
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || return 1
      ;;
  esac
  return 0
}

check_stats_json_fields() {
  local url="$1"
  shift
  local required=("$@")
  local tmp
  tmp="$(mktemp)"
  local meta code json_valid json_missing
  meta="$(fetch_with_meta "$url" "$tmp")"
  code="${meta%%|*}"
  json_valid="false"
  json_missing=""
  if jq -e . "$tmp" >/dev/null 2>&1; then
    json_valid="true"
    local missing=()
    local field
    for field in "${required[@]}"; do
      if ! jq -e --arg k "$field" 'has($k)' "$tmp" >/dev/null 2>&1; then
        missing+=("$field")
      fi
    done
    if [[ "${#missing[@]}" -gt 0 ]]; then
      json_missing="$(IFS=,; printf '%s' "${missing[*]}")"
    fi
  fi
  printf '%s|%s|%s\n' "$code" "$json_valid" "$json_missing"
}

link_walk_report() {
  local host="$1"
  local home_file="$2"
  local stats_file="$3"
  local base="https://${host}"
  local fail=0
  local links_file
  links_file="$(mktemp)"
  {
    extract_links "$base" "$home_file"
    extract_links "$base" "$stats_file"
  } | sort -u >"$links_file"

  while IFS= read -r link; do
    [[ -z "$link" ]] && continue
    local target="$link"
    case "$target" in
      https://a2abench-api.web.app/*|https://ragmap-api.web.app/*|https://rootfetch.com/*)
        target="$(append_cb "$target")"
        ;;
    esac
    local body meta code effective pass json_ok
    body="$(mktemp)"
    meta="$(fetch_with_meta "$target" "$body")"
    code="${meta%%|*}"
    effective="${meta#*|}"
    pass="true"
    json_ok="n/a"
    if [[ "$code" != "200" ]]; then
      pass="false"
    fi
    if expects_json "$target"; then
      if jq -e . "$body" >/dev/null 2>&1; then
        json_ok="true"
      else
        json_ok="false"
        pass="false"
      fi
    fi
    if [[ "$pass" == "false" ]]; then
      fail=1
    fi
    echo "    ${target} => HTTP ${code}, final_url=${effective}, json_valid=${json_ok}, pass=${pass}"
  done <"$links_file"

  return "$fail"
}

report_project() {
  local project="$1"
  local host="$2"
  shift 2
  local fields=("$@")
  local base="https://${host}"
  local home_url stats_url json_url robots_url sitemap_url
  home_url="$(append_cb "${base}/")"
  stats_url="$(append_cb "${base}/stats")"
  json_url="$(append_cb "${base}/stats.json")"
  robots_url="${base}/robots.txt"
  sitemap_url="${base}/sitemap.xml"

  local home_body stats_body robots_body sitemap_body
  home_body="$(mktemp)"
  stats_body="$(mktemp)"
  robots_body="$(mktemp)"
  sitemap_body="$(mktemp)"

  local home_meta stats_meta robots_meta sitemap_meta
  local home_code stats_code robots_code sitemap_code
  home_meta="$(fetch_with_meta "$home_url" "$home_body")"
  stats_meta="$(fetch_with_meta "$stats_url" "$stats_body")"
  robots_meta="$(fetch_with_meta "$robots_url" "$robots_body")"
  sitemap_meta="$(fetch_with_meta "$sitemap_url" "$sitemap_body")"
  home_code="${home_meta%%|*}"
  stats_code="${stats_meta%%|*}"
  robots_code="${robots_meta%%|*}"
  sitemap_code="${sitemap_meta%%|*}"

  local home_loading stats_loading
  home_loading="$(rg -io '\bloading(\.\.\.|…)?\b' "$home_body" | wc -l | tr -d ' ')"
  stats_loading="$(rg -io '\bloading(\.\.\.|…)?\b' "$stats_body" | wc -l | tr -d ' ')"

  local required_present="false"
  if check_required_strings "$host" "$home_body"; then
    required_present="true"
  fi

  local stats_allowed="false" stats_in_sitemap="false"
  if rg -q '^Allow: /stats$' "$robots_body" && rg -q '^Allow: /stats\.json$' "$robots_body"; then
    stats_allowed="true"
  fi
  if rg -q "<loc>${base}/stats</loc>" "$sitemap_body" && rg -q "<loc>${base}/stats.json</loc>" "$sitemap_body"; then
    stats_in_sitemap="true"
  fi

  local json_info json_code json_valid json_missing
  json_info="$(check_stats_json_fields "$json_url" "${fields[@]}")"
  IFS='|' read -r json_code json_valid json_missing <<<"$json_info"

  echo "project: ${project}"
  echo "external_gate:"
  echo "  ${home_url}            => HTTP ${home_code}, loading_count=${home_loading}, required_strings_present=${required_present}"
  echo "  ${stats_url}       => HTTP ${stats_code}, loading_count=${stats_loading}, required_strings_present=${required_present}"
  if [[ -n "$json_missing" ]]; then
    echo "  ${json_url}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[${json_missing}]"
  else
    echo "  ${json_url}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[]"
  fi
  echo "  ${robots_url}          => stats_allowed=${stats_allowed}"
  echo "  ${sitemap_url}         => stats_in_sitemap=${stats_in_sitemap}"
  echo "  link_walk:"
  local link_walk_failed="false"
  if ! link_walk_report "$host" "$home_body" "$stats_body"; then
    link_walk_failed="true"
  fi

  local fail_reason=""
  [[ "$home_code" == "200" ]] || fail_reason="home_http"
  [[ "$stats_code" == "200" ]] || fail_reason="${fail_reason:-stats_http}"
  [[ "$json_code" == "200" ]] || fail_reason="${fail_reason:-json_http}"
  [[ "$home_loading" == "0" ]] || fail_reason="${fail_reason:-home_loading}"
  [[ "$stats_loading" == "0" ]] || fail_reason="${fail_reason:-stats_loading}"
  [[ "$required_present" == "true" ]] || fail_reason="${fail_reason:-required_strings}"
  [[ "$json_valid" == "true" && -z "$json_missing" ]] || fail_reason="${fail_reason:-json_fields}"
  [[ "$stats_allowed" == "true" ]] || fail_reason="${fail_reason:-robots}"
  [[ "$stats_in_sitemap" == "true" ]] || fail_reason="${fail_reason:-sitemap}"
  [[ "$link_walk_failed" == "false" ]] || fail_reason="${fail_reason:-link_walk}"

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
