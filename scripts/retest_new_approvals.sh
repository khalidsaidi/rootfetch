#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

declare -a ROOTFETCH_ENV_FILES_LOADED=()

load_env_file_if_present() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    ROOTFETCH_ENV_FILES_LOADED+=("$file")
  fi
}

require_czds_credentials() {
  local missing=()
  [[ -n "${CZDS_USERNAME:-}" ]] || missing+=("CZDS_USERNAME")
  [[ -n "${CZDS_PASSWORD:-}" ]] || missing+=("CZDS_PASSWORD")
  if (( ${#missing[@]} > 0 )); then
    echo "[retest] missing required credentials: ${missing[*]}" >&2
    echo "[retest] expected local credential file: .env.czds (gitignored)" >&2
    echo "[retest] setup:" >&2
    echo "  cp .env.example .env.czds" >&2
    echo "  edit .env.czds and set CZDS_USERNAME/CZDS_PASSWORD" >&2
    echo "  chmod 600 .env.czds" >&2
    echo "  rootfetch auth-check" >&2
    exit 2
  fi
}

# Load order: canonical credential file first, then legacy env, then MCP settings.
load_env_file_if_present ".env.czds"
load_env_file_if_present ".env"
load_env_file_if_present ".env.mcp"
echo "[retest] env files loaded: ${ROOTFETCH_ENV_FILES_LOADED[*]:-(none)}"
require_czds_credentials

TODAY="$(date -u +%F)"
echo "[retest] date_utc=${TODAY}"

echo "[retest] running local orchestrator"
./scripts/local_run_hybrid.sh

echo "[retest] post-run local coverage"
python3 - <<'PY'
import json
cov=json.load(open("data/signals/coverage_latest.json"))
print("approved_tlds_count=", cov.get("approved_tlds_count"))
print("counted_ever_count=", cov.get("counted_ever_count"))
print("missing_ever_count=", cov.get("missing_ever_count"))
PY

VERCEL_BASE="${ROOTFETCH_PUBLIC_BASE_URL:-https://rootfetch.vercel.app}"
VERCEL_BASE="${VERCEL_BASE%/}"
echo "[retest] verifying deployed read-only artifacts from ${VERCEL_BASE}"
curl -s "${VERCEL_BASE}/rootfetch/approved_latest.json" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("vercel_approved_count=", d.get("count"))'
curl -s "${VERCEL_BASE}/rootfetch/coverage_latest.json" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("vercel_missing_ever=", d.get("missing_ever_count"), "vercel_counted_ever=", d.get("counted_ever_count"))'

echo "[retest] running live MCP checks"
python3 scripts/mcp_live_check.py "$@"

echo "[retest] done"
