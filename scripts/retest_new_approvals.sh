#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -f .env.mcp ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.mcp
  set +a
fi

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
