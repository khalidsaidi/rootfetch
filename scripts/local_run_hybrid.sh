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
    echo "[rootfetch] missing required credentials: ${missing[*]}" >&2
    echo "[rootfetch] expected local credential file: .env.czds (gitignored)" >&2
    echo "[rootfetch] setup:" >&2
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
echo "[rootfetch] env files loaded: ${ROOTFETCH_ENV_FILES_LOADED[*]:-(none)}"
require_czds_credentials

TODAY="$(date -u +%F)"

echo "[rootfetch] discover ${TODAY}"
rootfetch discover

echo "[rootfetch] baseline-status ${TODAY}"
STATUS_JSON="$(rootfetch baseline-status --date "${TODAY}")"
echo "${STATUS_JSON}"
BASELINE_MARKER="$(
  printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("baseline_complete") else "0")'
)"
MISSING_EVER="$(
  printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("missing_ever_count") or 0))'
)"
BASELINE_COMPLETE="0"
if [[ "${BASELINE_MARKER}" == "1" && "${MISSING_EVER}" -eq 0 ]]; then
  BASELINE_COMPLETE="1"
fi

if [[ "${BASELINE_COMPLETE}" != "1" ]]; then
  COVERAGE_PATH="$(
    printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("coverage_path") or "").strip())'
  )"
  if [[ -n "${COVERAGE_PATH}" && -f "${COVERAGE_PATH}" ]]; then
    echo "[rootfetch] baseline missing_ever_tlds (up to 25 shown):"
    python3 - <<'PY' "${COVERAGE_PATH}"
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"[rootfetch] unable to read coverage payload: {exc}")
    raise SystemExit(0)

missing = payload.get("missing_ever_tlds", [])
if not isinstance(missing, list):
    missing = []
for tld in missing[:25]:
    print(f"  - {str(tld).strip().lower()}")
if len(missing) > 25:
    print(f"  ... ({len(missing) - 25} more)")
PY
  fi
fi

RUN_RESULT_JSON=""
RUN_DATE="${TODAY}"
if [[ "${BASELINE_COMPLETE}" == "1" ]]; then
  echo "[rootfetch] baseline complete, running hybrid ${TODAY}"
  RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}")"
else
  echo "[rootfetch] baseline incomplete, running baseline resume loop until 100%"
  BASELINE_MAX_PASSES="${ROOTFETCH_BASELINE_MAX_PASSES:-6}"
  BASELINE_MAX_SECONDS="${ROOTFETCH_BASELINE_MAX_SECONDS:-900}"
  BASELINE_STALL_PASSES="${ROOTFETCH_BASELINE_STALL_PASSES:-2}"
  BASELINE_PASS_TIMEOUT_SECONDS="${ROOTFETCH_BASELINE_PASS_TIMEOUT_SECONDS:-480}"
  BASELINE_LOOP_STARTED_AT="$(date -u +%s)"
  PREV_MISSING_EVER="${MISSING_EVER:-0}"
  STALL_COUNT=0
  PASS=0
  while true; do
    PASS="$((PASS + 1))"
    echo "[rootfetch] baseline pass ${PASS}"
    if command -v timeout >/dev/null 2>&1; then
      set +e
      RUN_RESULT_JSON="$(timeout "${BASELINE_PASS_TIMEOUT_SECONDS}" rootfetch run-baseline --resume)"
      RC=$?
      set -e
      if [[ "${RC}" -ne 0 ]]; then
        if [[ "${RC}" -eq 124 || "${RC}" -eq 137 ]]; then
          echo "[rootfetch] baseline pass timed out after ${BASELINE_PASS_TIMEOUT_SECONDS}s; continuing with hybrid using incomplete baseline"
          RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}" --allow-incomplete-baseline)"
          break
        fi
        echo "[rootfetch] baseline pass failed with exit code ${RC}" >&2
        exit "${RC}"
      fi
    else
      RUN_RESULT_JSON="$(rootfetch run-baseline --resume)"
    fi
    echo "${RUN_RESULT_JSON}"

    RUN_DATE="$(
      printf '%s' "${RUN_RESULT_JSON}" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("date_utc") or "").strip())'
    )"
    if [[ -z "${RUN_DATE}" ]]; then
      RUN_DATE="${TODAY}"
    fi

    STATUS_JSON="$(rootfetch baseline-status --date "${RUN_DATE}")"
    echo "${STATUS_JSON}"
    BASELINE_MARKER="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("baseline_complete") else "0")'
    )"
    COUNTED_EVER="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("counted_ever_count") or 0))'
    )"
    MISSING_EVER="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("missing_ever_count") or 0))'
    )"
    BASELINE_COMPLETE="0"
    if [[ "${BASELINE_MARKER}" == "1" && "${MISSING_EVER}" -eq 0 ]]; then
      BASELINE_COMPLETE="1"
    fi
    echo "[rootfetch] baseline progress processed_ok=${COUNTED_EVER} remaining=${MISSING_EVER}"

    if [[ "${BASELINE_COMPLETE}" == "1" ]]; then
      echo "[rootfetch] baseline complete, switching to hybrid ${TODAY}"
      RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}")"
      break
    fi

    if [[ "${MISSING_EVER}" -eq "${PREV_MISSING_EVER}" ]]; then
      STALL_COUNT="$((STALL_COUNT + 1))"
    else
      STALL_COUNT=0
    fi
    PREV_MISSING_EVER="${MISSING_EVER}"

    NOW_EPOCH="$(date -u +%s)"
    ELAPSED_SECONDS="$((NOW_EPOCH - BASELINE_LOOP_STARTED_AT))"
    if [[ "${PASS}" -ge "${BASELINE_MAX_PASSES}" ]]; then
      echo "[rootfetch] baseline resume reached pass limit (${BASELINE_MAX_PASSES}); continuing with hybrid using incomplete baseline"
      RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}" --allow-incomplete-baseline)"
      break
    fi
    if [[ "${ELAPSED_SECONDS}" -ge "${BASELINE_MAX_SECONDS}" ]]; then
      echo "[rootfetch] baseline resume reached time budget (${BASELINE_MAX_SECONDS}s); continuing with hybrid using incomplete baseline"
      RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}" --allow-incomplete-baseline)"
      break
    fi
    if [[ "${STALL_COUNT}" -ge "${BASELINE_STALL_PASSES}" ]]; then
      echo "[rootfetch] baseline resume stalled (remaining unchanged for ${STALL_COUNT} pass(es)); continuing with hybrid using incomplete baseline"
      RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}" --allow-incomplete-baseline)"
      break
    fi
  done
fi
echo "${RUN_RESULT_JSON}"
RUN_DATE="$(
  printf '%s' "${RUN_RESULT_JSON}" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("date_utc") or "").strip())'
)"
if [[ -z "${RUN_DATE}" ]]; then
  RUN_DATE="${TODAY}"
fi

echo "[rootfetch] compute-signals ${RUN_DATE}"
rootfetch compute-signals --date "${RUN_DATE}"

echo "[rootfetch] alerts run ${RUN_DATE}"
rootfetch alerts run --date "${RUN_DATE}" || true

echo "[rootfetch] build static rag"
rootfetch rag build-static

PUBLISH_SNAPSHOT_TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PUBLISH_BUNDLE_DIR=".ai/publish/latest"

echo "[rootfetch] publish prepare ${RUN_DATE}"
rootfetch publish prepare \
  --date "${RUN_DATE}" \
  --out-dir "${PUBLISH_BUNDLE_DIR}" \
  --snapshot-ts-utc "${PUBLISH_SNAPSHOT_TS_UTC}" \
  --model-version "rootfetch_model_v1"

echo "[rootfetch] publish run ${RUN_DATE}"
rootfetch publish run \
  --source-dir "${PUBLISH_BUNDLE_DIR}" \
  --artifacts-root "data/artifacts" \
  --model-version "rootfetch_model_v1" \
  --snapshot-ts-utc "${PUBLISH_SNAPSHOT_TS_UTC}"

echo "[rootfetch] build ops scoreboard"
python3 scripts/build_ops_scoreboard.py

git add data/approved_tlds/*.json || true
git add "data/daily_counts/${RUN_DATE}.csv" || true
git add "data/growth_trends.csv" || true
git add data/signals/*.csv data/signals/*.json || true
git add data/digests/*.md || true
git add data/rag/*.json || true
git add data/artifacts || true
git add data/ops/*.json data/ops/*.csv || true
git add data/state/baseline_complete.json || true

STAGED="$(git diff --cached --name-only || true)"
if [[ -z "${STAGED}" ]]; then
  echo "[rootfetch] no changes to commit"
  exit 0
fi

if echo "${STAGED}" | grep -E '(^\.ai/|(^|/)\.env($|\.|/)|token\.json$|\.gz$|\.zone$|\.txt\.gz$)' >/dev/null; then
  echo "[rootfetch] forbidden staged paths detected:"
  echo "${STAGED}" | grep -E '(^\.ai/|(^|/)\.env($|\.|/)|token\.json$|\.gz$|\.zone$|\.txt\.gz$)' || true
  exit 1
fi

git commit -m "RootFetch local hybrid update ${TODAY}" || true
git push origin main

echo "[rootfetch] done"
