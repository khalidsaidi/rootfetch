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

echo "[rootfetch] run-hybrid ${TODAY}"
rootfetch run-hybrid --date "${TODAY}"

echo "[rootfetch] compute-signals ${TODAY}"
rootfetch compute-signals --date "${TODAY}"

echo "[rootfetch] build static rag"
rootfetch rag build-static

git add "data/approved_tlds/latest.json" || true
git add "data/approved_tlds/${TODAY}.json" || true
git add "data/daily_counts/${TODAY}.csv" || true
git add "data/growth_trends.csv" || true
git add data/signals/*.csv data/signals/*.json || true
git add data/digests/*.md || true
git add data/rag/*.json || true

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
