#!/usr/bin/env bash
set -euo pipefail

TS="${1:-$(date +%s)}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 2; }
}

require_cmd curl
require_cmd jq
require_cmd rg
require_cmd perl

PROJECT_HOSTS=(
  "a2abench-api.web.app"
  "ragmap-api.web.app"
  "rootfetch.com"
  "agentability.org"
  "relayorb.com"
)

is_project_host() {
  local host="$1"
  local item
  for item in "${PROJECT_HOSTS[@]}"; do
    [[ "$item" == "$host" ]] && return 0
  done
  return 1
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

fetch_with_meta() {
  local url="$1"
  local out="$2"
  curl -sS -L -X GET \
    --connect-timeout 5 \
    --max-time 20 \
    -H 'Cache-Control: no-cache' \
    -H 'Pragma: no-cache' \
    --cookie '' \
    --cookie-jar /dev/null \
    -o "$out" \
    -w '%{http_code}|%{url_effective}|%{content_type}' \
    "$url"
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
  perl -0777 -ne 'while (/<a\b[^>]*\bhref\s*=\s*["'"'"'"'"'"']([^"'"'"'"'"'"']+)["'"'"'"'"'"']/ig) { print "$1\n"; }' "$file" \
    | while IFS= read -r href; do resolve_href "$base" "$href"; done \
    | rg -v '^$' \
    | sort -u
}

emit_raw_html() {
  local label="$1"
  local file="$2"
  echo "  raw_${label}_begin"
  sed 's/></>\n</g' "$file" | sed -n '1,200p'
  echo "  raw_${label}_end"
}

emit_raw_text() {
  local label="$1"
  local file="$2"
  echo "  raw_${label}_begin"
  sed -n '1,200p' "$file"
  echo "  raw_${label}_end"
}

expects_json() {
  local url="$1"
  case "$url" in
    */stats.json*|*/api/stats*|*/rag/stats*|*/v1/eval/leaderboard*|*/.well-known/agent.json*|*/.well-known/agent-card.json*) return 0 ;;
    *) return 1 ;;
  esac
}

should_enforce_footer() {
  local path="$1"
  case "$path" in
    /stats.json|/llms.txt|/.well-known/agent.json|/.well-known/agent-card.json|/robots.txt|/sitemap.xml|/health|/healthz|/readyz|/v1/eval/leaderboard|/v1/eval/questions|/api/stats|/rag/stats|/api/openapi.json)
      return 1
      ;;
    /v0.1/servers/*|/_next/*|/assets/*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

expected_footer_urls() {
  local host="$1"
  case "$host" in
    a2abench-api.web.app)
      printf 'https://ragmap-api.web.app/stats\nhttps://rootfetch.com/stats\nhttps://agentability.org/stats\nhttps://relayorb.com/stats\n'
      ;;
    ragmap-api.web.app)
      printf 'https://a2abench-api.web.app/stats\nhttps://rootfetch.com/stats\nhttps://agentability.org/stats\nhttps://relayorb.com/stats\n'
      ;;
    rootfetch.com)
      printf 'https://a2abench-api.web.app/stats\nhttps://ragmap-api.web.app/stats\nhttps://agentability.org/stats\nhttps://relayorb.com/stats\n'
      ;;
    agentability.org)
      printf 'https://a2abench-api.web.app/stats\nhttps://ragmap-api.web.app/stats\nhttps://rootfetch.com/stats\nhttps://relayorb.com/stats\n'
      ;;
    relayorb.com)
      printf 'https://a2abench-api.web.app/stats\nhttps://ragmap-api.web.app/stats\nhttps://rootfetch.com/stats\nhttps://agentability.org/stats\n'
      ;;
    *)
      ;;
  esac
}

check_footer_body() {
  local host="$1"
  local file="$2"
  local required
  while IFS= read -r required; do
    [[ -z "$required" ]] && continue
    if ! rg -Fq "$required" "$file"; then
      return 1
    fi
  done < <(expected_footer_urls "$host")
  rg -Fq 'Cross-project:' "$file" || return 1
  return 0
}

check_target() {
  local target="$1"
  local body meta code effective ctype pass json_ok
  body="$(mktemp)"
  meta="$(fetch_with_meta "$target" "$body")"
  code="${meta%%|*}"
  effective="${meta#*|}"
  ctype="${effective#*|}"
  effective="${effective%%|*}"
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

  printf '%s|%s|%s|%s|%s|%s\n' "$code" "$effective" "$json_ok" "$pass" "$ctype" "$body"
}

run_self_test_404() {
  local probe="https://a2abench-api.web.app/__gate_runner_known_404__?cb=${TS}"
  local code effective json_ok pass ctype body
  IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$probe")"
  if [[ "$code" == "200" || "$pass" == "true" ]]; then
    echo "gate_self_test_404: FAIL ${probe} => HTTP ${code}, pass=${pass}"
    exit 1
  fi
  echo "gate_self_test_404: PASS ${probe} => HTTP ${code}, pass=${pass}"
}

run_self_test_footer_logic() {
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<'HTML'
<!doctype html><html><body><main>No footer links here</main></body></html>
HTML
  if check_footer_body "a2abench-api.web.app" "$tmp"; then
    echo "gate_self_test_footer: FAIL missing footer accepted"
    exit 1
  fi
  echo "gate_self_test_footer: PASS missing footer rejected"
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
      rg -Fq 'href="/request-key"' "$home_body" || return 1
      rg -Fq 'href="/feedback"' "$home_body" || return 1
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || return 1
      rg -Fq 'https://relayorb.com/stats' "$home_body" || return 1
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
      rg -Fq 'https://relayorb.com/stats' "$home_body" || return 1
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
      rg -Fq 'https://relayorb.com/stats' "$home_body" || return 1
      ;;
    agentability.org)
      rg -Fq '/stats' "$home_body" || return 1
      rg -Fq '/stats.json' "$home_body" || return 1
      rg -Fq '/.well-known/agent.json' "$home_body" || return 1
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || return 1
      rg -Fq 'https://relayorb.com/stats' "$home_body" || return 1
      ;;
    relayorb.com)
      rg -Fq '/stats' "$home_body" || return 1
      rg -Fq '/stats.json' "$home_body" || return 1
      rg -Fq '/.well-known/agent.json' "$home_body" || return 1
      rg -Fq 'https://a2abench-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://ragmap-api.web.app/stats' "$home_body" || return 1
      rg -Fq 'https://rootfetch.com/stats' "$home_body" || return 1
      rg -Fq 'https://agentability.org/stats' "$home_body" || return 1
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
  printf '%s|%s|%s|%s\n' "$code" "$json_valid" "$json_missing" "$tmp"
}

check_siblings_object() {
  local json_file="$1"
  local self_key="$2"
  local missing=""
  local key
  for key in a2abench ragmap rootfetch agentability relayorb; do
    [[ "$key" == "$self_key" ]] && continue
    if ! jq -e --arg k "$key" '.siblings and (.siblings | has($k))' "$json_file" >/dev/null 2>&1; then
      missing+="${key},"
    fi
  done
  printf '%s' "${missing%,}"
}

check_siblings_urls() {
  local json_file="$1"
  local self_key="$2"
  local fail=0
  local key
  for key in a2abench ragmap rootfetch agentability relayorb; do
    [[ "$key" == "$self_key" ]] && continue
    local url stats_url stats_json_url agent_card_url
    url="$(jq -r --arg k "$key" '.siblings[$k].url // empty' "$json_file")"
    stats_url="$(jq -r --arg k "$key" '.siblings[$k].stats_url // empty' "$json_file")"
    stats_json_url="$(jq -r --arg k "$key" '.siblings[$k].stats_json_url // empty' "$json_file")"
    agent_card_url="$(jq -r --arg k "$key" '.siblings[$k].agent_card_url // empty' "$json_file")"
    for target in "$url" "$stats_url" "$stats_json_url" "$agent_card_url"; do
      [[ -z "$target" ]] && fail=1 && continue
      local code effective json_ok pass ctype body
      IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$(append_cb "$target")")"
      echo "    siblings_check ${target} => HTTP ${code}, pass=${pass}"
      [[ "$pass" == "true" ]] || fail=1
    done
  done
  return "$fail"
}

check_agent_related() {
  local base="$1"
  local fail=0
  local meta code effective ctype json_ok pass body
  IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$(append_cb "${base}/.well-known/agent.json")")"
  if [[ "$code" != "200" || "$json_ok" != "true" ]]; then
    echo "  ${base}/.well-known/agent.json => HTTP ${code}, related_ok=false"
    return 1
  fi
  local related_len
  related_len="$(jq -r '.related | length // 0' "$body")"
  if [[ "$related_len" != "4" ]]; then
    echo "  ${base}/.well-known/agent.json => related_count=${related_len} (expected 4)"
    fail=1
  fi
  local idx=0
  while [[ "$idx" -lt "$related_len" ]]; do
    local url card
    url="$(jq -r --argjson i "$idx" '.related[$i].url // empty' "$body")"
    card="$(jq -r --argjson i "$idx" '.related[$i].agent_card_url // empty' "$body")"
    for target in "$url" "$card"; do
      [[ -z "$target" ]] && fail=1 && continue
      local c e j p ct b
      IFS='|' read -r c e j p ct b <<<"$(check_target "$(append_cb "$target")")"
      echo "    related_check ${target} => HTTP ${c}, pass=${p}"
      [[ "$p" == "true" ]] || fail=1
    done
    idx=$((idx + 1))
  done
  [[ "$fail" -eq 0 ]]
}

check_llms_related() {
  local base="$1"
  local self_host="$2"
  local llms="$(mktemp)"
  local meta code effective ctype
  meta="$(fetch_with_meta "$(append_cb "${base}/llms.txt")" "$llms")"
  code="${meta%%|*}"
  effective="${meta#*|}"; effective="${effective%%|*}"
  ctype="${meta##*|}"
  local pass=true
  [[ "$code" == "200" ]] || pass=false
  rg -Fq '## Related projects' "$llms" || pass=false
  case "$self_host" in
    a2abench-api.web.app)
      rg -Fq 'https://ragmap-api.web.app' "$llms" || pass=false
      rg -Fq 'https://rootfetch.com' "$llms" || pass=false
      rg -Fq 'https://agentability.org' "$llms" || pass=false
      rg -Fq 'https://relayorb.com' "$llms" || pass=false
      ;;
    ragmap-api.web.app)
      rg -Fq 'https://a2abench-api.web.app' "$llms" || pass=false
      rg -Fq 'https://rootfetch.com' "$llms" || pass=false
      rg -Fq 'https://agentability.org' "$llms" || pass=false
      rg -Fq 'https://relayorb.com' "$llms" || pass=false
      ;;
    rootfetch.com)
      rg -Fq 'https://a2abench-api.web.app' "$llms" || pass=false
      rg -Fq 'https://ragmap-api.web.app' "$llms" || pass=false
      rg -Fq 'https://agentability.org' "$llms" || pass=false
      rg -Fq 'https://relayorb.com' "$llms" || pass=false
      ;;
    agentability.org)
      rg -Fq 'https://a2abench-api.web.app' "$llms" || pass=false
      rg -Fq 'https://ragmap-api.web.app' "$llms" || pass=false
      rg -Fq 'https://rootfetch.com' "$llms" || pass=false
      rg -Fq 'https://relayorb.com' "$llms" || pass=false
      ;;
    relayorb.com)
      rg -Fq 'https://a2abench-api.web.app' "$llms" || pass=false
      rg -Fq 'https://ragmap-api.web.app' "$llms" || pass=false
      rg -Fq 'https://rootfetch.com' "$llms" || pass=false
      rg -Fq 'https://agentability.org' "$llms" || pass=false
      ;;
  esac
  echo "  ${base}/llms.txt => HTTP ${code}, related_section_ok=${pass}"
  [[ "$pass" == "true" ]]
}

extract_html_timestamp() {
  local file="$1"
  rg -o '20[0-9]{2}-[01][0-9]-[0-3][0-9]T[0-9:.]+Z' "$file" | head -n 1 || true
}

timestamp_to_epoch() {
  local iso="$1"
  if [[ -z "$iso" ]]; then
    printf '0'
    return
  fi
  date -u -d "$iso" +%s 2>/dev/null || printf '0'
}

check_stats_timestamp_drift() {
  local stats_html_file="$1"
  local stats_json_file="$2"
  local html_iso json_iso html_epoch json_epoch diff
  html_iso="$(extract_html_timestamp "$stats_html_file")"
  json_iso="$(jq -r '.generated_at // empty' "$stats_json_file")"
  html_epoch="$(timestamp_to_epoch "$html_iso")"
  json_epoch="$(timestamp_to_epoch "$json_iso")"
  if [[ "$html_epoch" -eq 0 || "$json_epoch" -eq 0 ]]; then
    echo "unknown|${html_iso}|${json_iso}"
    return
  fi
  diff=$((html_epoch - json_epoch))
  if [[ "$diff" -lt 0 ]]; then diff=$(( -diff )); fi
  echo "${diff}|${html_iso}|${json_iso}"
}

link_walk_report() {
  local project_host="$1"
  local home_file="$2"
  local stats_file="$3"
  local base="https://${project_host}"
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
    local link_host path
    link_host="$(printf '%s' "$target" | sed -E 's#^https?://([^/]+).*$#\1#')"
    path="$(printf '%s' "$target" | sed -E 's#^https?://[^/]+(/[^?]*)?.*$#\1#')"
    [[ -z "$path" ]] && path='/'

    if is_project_host "$link_host"; then
      target="$(append_cb "$target")"
    fi

    local code effective json_ok pass ctype body
    IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$target")"

    local footer_ok="n/a"
    local content_assert_ok="n/a"
    if [[ "$code" == "200" && "$ctype" == text/html* ]]; then
      if should_enforce_footer "$path"; then
        if is_project_host "$link_host" && check_footer_body "$link_host" "$body"; then
          footer_ok="true"
        elif is_project_host "$link_host"; then
          footer_ok="false"
          fail=1
        fi
      fi
    fi

    if is_project_host "$link_host"; then
      case "$path" in
        /stats.json)
          if [[ "$json_ok" == "true" ]] && jq -e '.siblings and (.siblings | type == "object") and ((.siblings | keys | length) >= 4)' "$body" >/dev/null 2>&1; then
            content_assert_ok="true"
          else
            content_assert_ok="false"
            fail=1
          fi
          ;;
        /.well-known/agent.json|/.well-known/agent-card.json)
          if [[ "$json_ok" == "true" ]] && jq -e '.related and (.related | type == "array") and ((.related | length) >= 4)' "$body" >/dev/null 2>&1; then
            content_assert_ok="true"
          else
            content_assert_ok="false"
            fail=1
          fi
          ;;
        /llms.txt)
          if rg -Fq '## Related projects' "$body"; then
            content_assert_ok="true"
          else
            content_assert_ok="false"
            fail=1
          fi
          ;;
      esac
    fi

    if [[ "$pass" == "false" ]]; then
      fail=1
    fi

    echo "    ${target} => HTTP ${code}, final_url=${effective}, content_type=${ctype}, json_valid=${json_ok}, footer_ok=${footer_ok}, content_assert_ok=${content_assert_ok}, pass=${pass}"
  done <"$links_file"

  return "$fail"
}

check_required_urls() {
  local host="$1"
  local _home_body="$2"
  local fail=0
  if [[ "$host" == "a2abench-api.web.app" ]]; then
    local url
    for url in "/feedback" "/request-key"; do
      local full="https://${host}${url}"
      local code effective json_ok pass ctype body
      IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$(append_cb "$full")")"
      echo "  ${full} => HTTP ${code}, pass=${pass}"
      [[ "$pass" == "true" ]] || fail=1
    done
  fi
  return "$fail"
}

check_relayorb_required_surfaces() {
  local fail=0
  local url
  for url in \
    "https://relayorb.com/.well-known/agent.json" \
    "https://relayorb.com/.well-known/air.json" \
    "https://relayorb.com/agent.json" \
    "https://relayorb.com/air.json" \
    "https://relayorb.com/.well-known/openapi.yaml" \
    "https://relayorb.com/openapi.yaml" \
    "https://relayorb.com/robots.txt" \
    "https://relayorb.com/sitemap.xml" \
    "https://relayorb.com/stats" \
    "https://relayorb.com/stats.json" \
    "https://relayorb.com/docs.md" \
    "https://relayorb.com/api.md" \
    "https://relayorb.com/spec.md" \
    "https://relayorb.com/status.md" \
    "https://relayorb.com/terms.md" \
    "https://relayorb.com/privacy.md" \
    "https://relayorb.com/cookies.md"; do
    local code effective json_ok pass ctype body
    IFS='|' read -r code effective json_ok pass ctype body <<<"$(check_target "$(append_cb "$url")")"
    echo "relayorb_surface_check: ${url} => HTTP ${code}, pass=${pass}, content_type=${ctype}"
    [[ "$pass" == "true" ]] || fail=1
  done
  local air_code air_effective air_json_ok air_pass air_ctype air_body
  IFS='|' read -r air_code air_effective air_json_ok air_pass air_ctype air_body <<<"$(check_target "$(append_cb "https://relayorb.com/.well-known/air.json")")"
  if [[ "$air_code" != "200" || "$air_json_ok" != "true" ]]; then
    fail=1
  elif ! jq -e '.siblings and (.siblings | type == "object") and ((.siblings | keys | length) >= 4)' "$air_body" >/dev/null 2>&1; then
    fail=1
  fi
  echo "relayorb_air_siblings_check: https://relayorb.com/.well-known/air.json => HTTP ${air_code}, json_valid=${air_json_ok}"
  local probe="https://relayorb.com/__qa_known_404_probe__?cb=${TS}"
  local pcode peffective pjson_ok ppass pctype pbody
  IFS='|' read -r pcode peffective pjson_ok ppass pctype pbody <<<"$(check_target "$probe")"
  echo "relayorb_404_check: ${probe} => HTTP ${pcode}, pass=${ppass}"
  [[ "$pcode" == "404" ]] || fail=1
  return "$fail"
}

check_rag_search() {
  local url="https://ragmap-api.web.app/rag/search?q=a2abench&cb=${TS}"
  local body="$(mktemp)"
  local meta code
  meta="$(fetch_with_meta "$url" "$body")"
  code="${meta%%|*}"
  local pass="false"
  if [[ "$code" == "200" ]] && jq -e . "$body" >/dev/null 2>&1; then
    if jq -e '
      [
        (.results[]?.url // ""),
        (.results[]?.homepage // ""),
        (.results[]?.reachableUrl // ""),
        (.results[]?.name // ""),
        (.results[]?.server?.repository?.url // "")
      ]
      | map(tostring | ascii_downcase)
      | any(
          contains("a2abench-api.web.app")
          or contains("a2abench-mcp.web.app")
          or contains("github.com/khalidsaidi/a2abench")
          or contains("a2abench")
        )
    ' "$body" >/dev/null 2>&1; then
      pass="true"
    fi
  fi
  echo "ragmap_search_check: ${url} => HTTP ${code}, pass=${pass}"
  echo "ragmap_search_json:"
  cat "$body"
  if [[ "$pass" != "true" ]]; then
    return 1
  fi
}

report_project() {
  local project="$1"
  local host="$2"
  local self_key="$3"
  shift 3
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
  home_loading="$( (rg -io '\bloading(\.\.\.|…)?\b' "$home_body" || true) | wc -l | tr -d ' ' )"
  stats_loading="$( (rg -io '\bloading(\.\.\.|…)?\b' "$stats_body" || true) | wc -l | tr -d ' ' )"

  local required_present="false"
  if check_required_strings "$host" "$home_body"; then
    required_present="true"
  fi

  local stats_allowed="true" stats_in_sitemap="false"
  if rg -qi '^Disallow:\s*/stats(\.json|\*|/|\s|$)' "$robots_body"; then
    stats_allowed="false"
  fi
  if rg -q "<loc>${base}/stats</loc>" "$sitemap_body" && rg -q "<loc>${base}/stats.json</loc>" "$sitemap_body"; then
    stats_in_sitemap="true"
  fi

  local json_info json_code json_valid json_missing json_file
  json_info="$(check_stats_json_fields "$json_url" "${fields[@]}")"
  IFS='|' read -r json_code json_valid json_missing json_file <<<"$json_info"

  local agent_url agent_body agent_meta agent_code
  agent_url="$(append_cb "${base}/.well-known/agent.json")"
  agent_body="$(mktemp)"
  agent_meta="$(fetch_with_meta "$agent_url" "$agent_body")"
  agent_code="${agent_meta%%|*}"

  local sibling_missing
  sibling_missing="$(check_siblings_object "$json_file" "$self_key")"

  local drift_info drift_seconds html_iso json_iso
  drift_info="$(check_stats_timestamp_drift "$stats_body" "$json_file")"
  IFS='|' read -r drift_seconds html_iso json_iso <<<"$drift_info"
  local drift_ok="false"
  if [[ "$drift_seconds" != "unknown" ]] && [[ "$drift_seconds" -le 300 ]]; then
    drift_ok="true"
  fi

  echo "project: ${project}"
  echo "external_gate:"
  echo "  ${home_url}            => HTTP ${home_code}, loading_count=${home_loading}, required_strings_present=${required_present}"
  echo "  ${stats_url}       => HTTP ${stats_code}, loading_count=${stats_loading}, required_strings_present=${required_present}"
  if [[ -n "$json_missing" ]]; then
    echo "  ${json_url}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[${json_missing}], missing_siblings=[${sibling_missing}]"
  else
    echo "  ${json_url}  => HTTP ${json_code}, json_valid=${json_valid}, missing_fields=[], missing_siblings=[${sibling_missing}]"
  fi
  echo "  ${robots_url}          => stats_allowed=${stats_allowed}"
  echo "  ${sitemap_url}         => stats_in_sitemap=${stats_in_sitemap}"
  echo "  timestamp_drift: html_ts=${html_iso}, json_ts=${json_iso}, drift_seconds=${drift_seconds}, pass=${drift_ok}"
  emit_raw_html "home" "$home_body"
  emit_raw_html "stats" "$stats_body"
  emit_raw_text "stats_json" "$json_file"
  if [[ "$agent_code" == "200" ]]; then
    emit_raw_text "agent_json" "$agent_body"
  else
    echo "  raw_agent_json_begin"
    echo "  failed_to_fetch_agent_json_http_${agent_code}"
    echo "  raw_agent_json_end"
  fi

  local fail_reason=""

  echo "  link_walk:"
  local link_walk_failed="false"
  if ! link_walk_report "$host" "$home_body" "$stats_body"; then
    link_walk_failed="true"
  fi

  echo "  sibling_url_checks:"
  if ! check_siblings_urls "$json_file" "$self_key"; then
    fail_reason="${fail_reason:-siblings_urls}"
  fi

  echo "  agent_related_checks:"
  if ! check_agent_related "$base"; then
    fail_reason="${fail_reason:-agent_related}"
  fi

  if ! check_llms_related "$base" "$host"; then
    fail_reason="${fail_reason:-llms_related}"
  fi

  if ! check_required_urls "$host" "$home_body"; then
    fail_reason="${fail_reason:-required_routes}"
  fi

  [[ "$home_code" == "200" ]] || fail_reason="${fail_reason:-home_http}"
  [[ "$stats_code" == "200" ]] || fail_reason="${fail_reason:-stats_http}"
  [[ "$json_code" == "200" ]] || fail_reason="${fail_reason:-json_http}"
  [[ "$home_loading" == "0" ]] || fail_reason="${fail_reason:-home_loading}"
  [[ "$stats_loading" == "0" ]] || fail_reason="${fail_reason:-stats_loading}"
  [[ "$required_present" == "true" ]] || fail_reason="${fail_reason:-required_strings}"
  [[ "$json_valid" == "true" && -z "$json_missing" ]] || fail_reason="${fail_reason:-json_fields}"
  [[ -z "$sibling_missing" ]] || fail_reason="${fail_reason:-siblings_missing}"
  [[ "$stats_allowed" == "true" ]] || fail_reason="${fail_reason:-robots}"
  [[ "$stats_in_sitemap" == "true" ]] || fail_reason="${fail_reason:-sitemap}"
  [[ "$drift_ok" == "true" ]] || fail_reason="${fail_reason:-timestamp_drift}"
  [[ "$link_walk_failed" == "false" ]] || fail_reason="${fail_reason:-link_walk}"

  if [[ -z "$fail_reason" ]]; then
    echo "verdict: PASS"
  else
    echo "verdict: FAIL (${fail_reason})"
  fi
  echo
}

run_self_test_404
run_self_test_footer_logic

report_project "a2abench" "a2abench-api.web.app" "a2abench" \
  submissions entrants_external keys_issued feedback_count baseline_runs last_submission_ts generated_at siblings
report_project "ragmap" "ragmap-api.web.app" "ragmap" \
  servers_indexed upstream_total coverage_pct last_ingest_ts weekly_distinct_callers weekly_queries bulk_scraper_callers bulk_scraper_calls generated_at siblings
report_project "rootfetch" "rootfetch.com" "rootfetch" \
  unique_callers_7d unique_callers_30d mcp_calls_7d mcp_calls_30d tool_call_success_pct last_run_id last_run_ts snapshot_freshness_hours generated_at siblings
report_project "agentability" "agentability.org" "agentability" \
  audits_run_total distinct_domains_audited audits_run_7d audits_run_30d median_audit_duration_seconds p95_audit_duration_seconds last_run_id last_run_ts score_distribution_30d generated_at siblings
report_project "relayorb" "relayorb.com" "relayorb" \
  invokes_total invokes_7d invokes_30d unique_callers_7d unique_callers_30d median_invoke_latency_ms p95_invoke_latency_ms idempotency_replays_total jobs_queued_current capabilities_registered workers_healthy policy_denials_7d tool_call_success_pct last_invoke_ts generated_at terraform_downloads siblings

check_rag_search
check_relayorb_required_surfaces
