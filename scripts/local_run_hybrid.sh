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

TODAY="$(date -u +%F)"

echo "[rootfetch] discover ${TODAY}"
rootfetch discover

echo "[rootfetch] baseline-status ${TODAY}"
STATUS_JSON="$(rootfetch baseline-status --date "${TODAY}")"
echo "${STATUS_JSON}"
BASELINE_COMPLETE="$(
  printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("baseline_complete") else "0")'
)"

RUN_RESULT_JSON=""
RUN_DATE="${TODAY}"
if [[ "${BASELINE_COMPLETE}" == "1" ]]; then
  echo "[rootfetch] baseline complete, running hybrid ${TODAY}"
  RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}")"
else
  echo "[rootfetch] baseline incomplete, running baseline resume loop until 100%"
  PASS=0
  while true; do
    PASS="$((PASS + 1))"
    echo "[rootfetch] baseline pass ${PASS}"
    RUN_RESULT_JSON="$(rootfetch run-baseline --resume)"
    echo "${RUN_RESULT_JSON}"

    RUN_DATE="$(
      printf '%s' "${RUN_RESULT_JSON}" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("date_utc") or "").strip())'
    )"
    if [[ -z "${RUN_DATE}" ]]; then
      RUN_DATE="${TODAY}"
    fi

    STATUS_JSON="$(rootfetch baseline-status --date "${RUN_DATE}")"
    echo "${STATUS_JSON}"
    BASELINE_COMPLETE="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("baseline_complete") else "0")'
    )"
    COUNTED_EVER="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("counted_ever_count") or 0))'
    )"
    MISSING_EVER="$(
      printf '%s' "${STATUS_JSON}" | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("missing_ever_count") or 0))'
    )"
    echo "[rootfetch] baseline progress processed_ok=${COUNTED_EVER} remaining=${MISSING_EVER}"

    if [[ "${BASELINE_COMPLETE}" == "1" ]]; then
      echo "[rootfetch] baseline complete, switching to hybrid ${TODAY}"
      RUN_RESULT_JSON="$(rootfetch run-hybrid --date "${TODAY}")"
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

echo "[rootfetch] build static rag"
rootfetch rag build-static

git add data/approved_tlds/*.json || true
git add "data/daily_counts/${RUN_DATE}.csv" || true
git add "data/growth_trends.csv" || true
git add data/signals/*.csv data/signals/*.json || true
git add data/digests/*.md || true
git add data/rag/*.json || true
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
