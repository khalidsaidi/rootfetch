#!/usr/bin/env bash
# ===========================
# RootFetch Challenge Pack v1
# ===========================
# Run this FROM the root of the rootfetch repo (where pyproject.toml / rootfetch/ exists).
# The agent must paste the FULL OUTPUT of this script back to you (but must NOT paste secrets).

set -euo pipefail

echo "== RootFetch Challenge Pack v1 =="
echo "UTC now: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ---------- 0) Confirm we are in a git repo ----------
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "FAIL: Not inside a git repository."
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "Repo root: $REPO_ROOT"
echo "Remote:"
git remote -v || true
echo "HEAD:"
git rev-parse HEAD
echo

# ---------- 1) MUST-have files & structure ----------
echo "== 1) Required files check =="
REQ_FILES=(
  ".gitignore"
  ".ai/execution_plan.md"
  ".ai/README.md"
  "docs/metrics_spec.md"
  "docs/signal_spec.md"
)
MISSING=0
for f in "${REQ_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "MISSING: $f"
    MISSING=1
  else
    echo "OK: $f"
  fi
done
if [[ "$MISSING" -eq 1 ]]; then
  echo "FAIL: required files missing."
  exit 1
fi
echo

echo "== 1b) Quick tree (depth 3) =="
# Avoid tree dependency; use find.
find . -maxdepth 3 -type f \
  | sed 's|^\./||' \
  | sort \
  | head -n 250
echo "…(showing first 250 files)"
echo

# ---------- 2) Safety: forbidden files MUST NOT be tracked ----------
echo "== 2) Forbidden tracked files (secrets/raw zones) =="
# Forbidden patterns in git-tracked files:
# - .env
# - token caches
# - raw zone gz/zone files
# - internal approved snapshots if they contain URLs
FORBIDDEN_REGEX='(^|/)(\.env$|token\.json$|.*\.(zone|zone\.gz|txt\.gz|gz)$|approved_snapshot\.json$|approved_links\.json$)'
BAD_TRACKED="$(git ls-files | grep -E "$FORBIDDEN_REGEX" || true)"
if [[ -n "$BAD_TRACKED" ]]; then
  echo "FAIL: Forbidden sensitive/raw files are TRACKED in git:"
  echo "$BAD_TRACKED"
  exit 1
fi
echo "PASS: No forbidden sensitive/raw files are tracked."
echo

echo "== 2b) Quick secret-pattern scan (best-effort) =="
# This does NOT guarantee no secrets, but catches obvious accidents.
# We avoid printing file contents; we only print filenames+line numbers.
git grep -nE "(BEGIN PRIVATE KEY|accessToken[\"']?\s*:\s*[\"']ey|Bearer\s+eyJ|CZDS_PASSWORD\s*=\s*[^$]|CZDS_TOTP_SECRET\s*=\s*[^$])" \
  -- . \
  || echo "OK: no obvious secret patterns found by grep (not a guarantee)."
echo

# ---------- 3) Spec compliance: discovery must be dynamic & correct endpoint must appear ----------
echo "== 3) Discovery endpoint + auth endpoint presence (code grep) =="
# These strings should exist somewhere in code if implemented as specified.
# (Doesn't prove correctness but catches missing wiring.)
AUTH_HIT="$(grep -RIn -- "account-api.icann.org" rootfetch 2>/dev/null || true)"
CZDS_HIT="$(grep -RIn -- "czds-api.icann.org" rootfetch 2>/dev/null || true)"
LINKS_HIT="$(grep -RIn -- "/czds/downloads/links" rootfetch 2>/dev/null || true)"

if [[ -z "$AUTH_HIT" ]]; then
  echo "WARN: couldn't find 'account-api.icann.org' in rootfetch/ (auth may be missing or configured differently)."
else
  echo "OK: found auth host reference:"
  echo "$AUTH_HIT" | head -n 5
  echo "…"
fi

if [[ -z "$CZDS_HIT" ]]; then
  echo "WARN: couldn't find 'czds-api.icann.org' in rootfetch/ (discovery/download may be missing or configured differently)."
else
  echo "OK: found CZDS host reference:"
  echo "$CZDS_HIT" | head -n 5
  echo "…"
fi

if [[ -z "$LINKS_HIT" ]]; then
  echo "WARN: couldn't find '/czds/downloads/links' reference (ensure discovery uses links endpoint and is NOT hardcoded)."
else
  echo "OK: found links endpoint reference:"
  echo "$LINKS_HIT" | head -n 5
  echo "…"
fi
echo

# ---------- 4) Python install + CLI smoke ----------
echo "== 4) Python packaging + CLI smoke test =="
if [[ -n "${PYTHON:-}" ]]; then
  PY="$PYTHON"
elif command -v python3.11 >/dev/null 2>&1; then
  PY="python3.11"
else
  PY="python3"
fi
$PY -V

# Use a venv inside .ai/tmp so it doesn't pollute the repo (and is gitignored).
mkdir -p .ai/tmp
VENV=".ai/tmp/venv"
if [[ ! -d "$VENV" ]]; then
  $PY -m venv "$VENV"
fi
# shellcheck disable=SC1090
source "$VENV/bin/activate"
python -m pip install -U pip >/dev/null

# Install editable (must work)
if [[ -f "pyproject.toml" ]]; then
  python -m pip install -e . >/dev/null
elif [[ -f "requirements.txt" ]]; then
  python -m pip install -r requirements.txt >/dev/null
else
  echo "FAIL: missing pyproject.toml or requirements.txt"
  exit 1
fi

# Compile check (catches syntax errors fast)
python -m compileall -q rootfetch || true

# CLI existence
if command -v rootfetch >/dev/null 2>&1; then
  echo "OK: rootfetch CLI is installed"
  echo "-- rootfetch --help (first 80 lines) --"
  rootfetch --help | head -n 80
else
  echo "FAIL: rootfetch CLI not found after install"
  exit 1
fi
echo

# ---------- 5) Correctness: zone counting MUST NOT be line counting ----------
echo "== 5) Offline zone-count correctness test (synthetic zone) =="
python - <<'PY'
import importlib, inspect, io, sys

sample_zone = """$ORIGIN demo.
@ 3600 IN SOA ns1.example.demo. hostmaster.example.demo. 1 7200 3600 1209600 3600
@ 3600 IN NS ns1.example.demo.
@ 3600 IN NS ns2.example.demo.

; SLD delegation (should count: example.demo)
example 3600 IN NS ns1.example.net.
example 3600 IN NS ns2.example.net.
example 3600 IN DS 12345 8 2 0123456789ABCDEF

; subdomain delegation (should NOT count as SLD)
sub.example 3600 IN NS ns1.example.net.

; another SLD owner written as FQDN (should count: other.demo)
other.demo. 3600 IN NS ns1.other.net.

; glue-ish A records under the TLD (optional secondary metrics)
ns1.example 3600 IN A 192.0.2.1
ns1.other   3600 IN A 192.0.2.2
"""

# Expected:
# - Unique SLD owners with NS: {"example.demo", "other.demo"} => 2
# - If someone is counting NS record lines, they'd get 6+ which is WRONG.

def load_zone_count_module():
    # Expected module path from spec; fall back to searching common alternatives.
    candidates = [
        "rootfetch.core.zone_count",
        "rootfetch.zone_count",
        "rootfetch.core.count",
        "rootfetch.core.counting",
    ]
    last = None
    for m in candidates:
        try:
            return importlib.import_module(m)
        except Exception as e:
            last = e
    raise ImportError(f"Could not import zone count module from candidates. Last error: {last}")

try:
    mod = load_zone_count_module()
except Exception as e:
    print("FAIL: zone count module import error:", e)
    sys.exit(1)

# Find best candidate function.
func_candidates = []
for name, obj in vars(mod).items():
    if not callable(obj):
        continue
    n = name.lower()
    if "count" not in n:
        continue
    try:
        sig = inspect.signature(obj)
    except Exception:
        continue
    # Needs at least (stream, tld) or (lines, tld)
    if len(sig.parameters) < 2:
        continue
    score = 0
    for key, pts in [("ns", 3), ("sld", 3), ("deleg", 2), ("zone", 1)]:
        if key in n:
            score += pts
    func_candidates.append((score, name, obj, sig))

if not func_candidates:
    print("FAIL: No suitable counting function found in module", mod.__name__)
    print("Hint: expose a function like count_delegated_ns_slds(stream, tld)->int or dict with count_ns_sld.")
    sys.exit(1)

func_candidates.sort(reverse=True)
score, name, fn, sig = func_candidates[0]
print(f"Using function: {mod.__name__}.{name}{sig} (score={score})")

out = fn(io.StringIO(sample_zone), "demo")
# Support multiple return shapes
val = None
if isinstance(out, dict):
    for k in ("count_ns_sld", "count", "ns_sld", "count_ns_slds"):
        if k in out:
            val = out[k]
            break
elif isinstance(out, (int, float)):
    val = out
elif isinstance(out, tuple) and out and isinstance(out[0], (int, float)):
    val = out[0]

if val is None:
    print("FAIL: Count function returned an unsupported type/shape:", type(out), out)
    sys.exit(1)

val = int(val)
if val != 2:
    print("FAIL: Expected unique NS SLD count = 2, got:", val)
    print("This often means you're counting lines/records instead of unique delegated SLD owners.")
    sys.exit(1)

print("PASS: Unique NS SLD count is correct (2). Not line-counting.")
PY
echo

# ---------- 6) Output schema sanity checks (if outputs exist) ----------
echo "== 6) Output schema checks (only if files exist) =="

python - <<'PY'
import csv, glob, json, os, sys
from datetime import datetime, timezone

def utc_today():
    return datetime.now(timezone.utc).date().isoformat()

today = utc_today()

# growth_trends.csv header check
gt = "data/growth_trends.csv"
if os.path.exists(gt):
    with open(gt, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
    required = {
        "date_utc","tld","count","delta_abs","delta_pct","is_estimate",
        "approved_today","run_id","fetched_at_utc"
    }
    missing = sorted(required - set(header))
    if missing:
        print("FAIL: growth_trends.csv missing columns:", missing)
        sys.exit(1)
    print("OK: growth_trends.csv has required columns")
else:
    print("INFO: data/growth_trends.csv not found yet (ok if you haven't run live)")

# daily_counts today file (if exists)
dc = f"data/daily_counts/{today}.csv"
if os.path.exists(dc):
    with open(dc, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
    required = {"date_utc","tld","count","is_estimate","source","fetched_at_utc","status"}
    missing = sorted(required - set(header))
    if missing:
        print("FAIL: daily_counts file missing columns:", missing)
        sys.exit(1)
    print("OK: daily_counts/<today>.csv has required columns")
else:
    print("INFO: daily_counts/<today>.csv not found yet (ok if you haven't run live)")

# approved_tlds today json must be sanitized (no URLs)
ap = f"data/approved_tlds/{today}.json"
if os.path.exists(ap):
    obj = json.load(open(ap, encoding="utf-8"))
    tlds = obj.get("tlds", [])
    if not isinstance(tlds, list):
        print("FAIL: approved_tlds schema wrong: tlds is not a list")
        sys.exit(1)
    blob = json.dumps(obj)
    if "http" in blob or "czds" in blob:
        print("FAIL: approved_tlds appears to contain URLs or CZDS hostnames (should be sanitized to tld names only)")
        sys.exit(1)
    print("OK: approved_tlds/<today>.json sanitized (no URLs)")
else:
    print("INFO: approved_tlds/<today>.json not found yet (ok if you haven't run live)")

# signals latest.json keys
lj = "data/signals/latest.json"
if os.path.exists(lj):
    obj = json.load(open(lj, encoding="utf-8"))
    required_keys = {"date_utc","run_id","approved_tlds_count","top_movers_abs","top_movers_pct","top_decliners_abs","anomalies","sector_snapshot"}
    missing = sorted(required_keys - set(obj.keys()))
    if missing:
        print("FAIL: data/signals/latest.json missing keys:", missing)
        sys.exit(1)
    print("OK: data/signals/latest.json has required keys")
else:
    print("INFO: data/signals/latest.json not found yet (ok if you haven't run live)")
PY
echo

# ---------- 7) Workflow presence check ----------
echo "== 7) GitHub Actions workflow check =="
WF_DIR=".github/workflows"
if [[ ! -d "$WF_DIR" ]]; then
  echo "FAIL: missing .github/workflows/"
  exit 1
fi
ls -la "$WF_DIR"

# Look for at least one workflow that mentions schedule or workflow_dispatch
WF_HIT="$(grep -RIn -- "workflow_dispatch" "$WF_DIR" 2>/dev/null || true)"
if [[ -z "$WF_HIT" ]]; then
  echo "WARN: No workflow_dispatch found. You should support manual runs."
else
  echo "OK: workflow_dispatch found:"
  echo "$WF_HIT" | head -n 5
  echo "…"
fi

SCH_HIT="$(grep -RIn -- "schedule:" "$WF_DIR" 2>/dev/null || true)"
if [[ -z "$SCH_HIT" ]]; then
  echo "WARN: No schedule found. Daily automation may be missing."
else
  echo "OK: schedule found:"
  echo "$SCH_HIT" | head -n 5
  echo "…"
fi
echo

echo "===================="
echo "PASS: Challenge pack completed (offline checks)."
echo "NEXT: run the LIVE challenges below (requires CZDS creds)."
echo "===================="

cat <<'LIVE'

=========================
LIVE CHALLENGES (CZDS)
=========================
Do NOT paste secrets. Only paste non-sensitive output summaries.

A) DISCOVERY (must be dynamic; no hardcoded TLD list)
  export CZDS_USERNAME="(set locally)"
  export CZDS_PASSWORD="(set locally)"
  # optional if needed:
  export CZDS_TOTP_SECRET="(only if needed)"

  rootfetch discover

  # Then prove sanitized output exists and has no URLs:
  python - <<'PY'
import json, glob, os
from datetime import datetime, timezone
today = datetime.now(timezone.utc).date().isoformat()
p = f"data/approved_tlds/{today}.json"
print("Reading:", p)
obj = json.load(open(p, encoding="utf-8"))
print("approved_tlds_count =", obj.get("count"))
blob = json.dumps(obj)
print("contains_http =", ("http" in blob))
PY

B) RUN-DAILY (start small; must write outputs + signals)
  export ROOTFETCH_TLD_ALLOWLIST="app,dev,shop,xyz"
  rootfetch run-daily

  # Prove outputs exist:
  ls -la data/daily_counts/ | tail -n 20
  ls -la data/signals/ | tail -n 40
  tail -n 5 data/growth_trends.csv

C) IDEMPOTENCY (run again same day; MUST NOT duplicate rows for same date+tld)
  rootfetch run-daily

  # Verify no duplicate (date_utc,tld) pairs for today's date in growth_trends:
  python - <<'PY'
import csv
from collections import Counter
from datetime import datetime, timezone
today = datetime.now(timezone.utc).date().isoformat()
rows=[]
with open("data/growth_trends.csv", newline="", encoding="utf-8") as f:
    r=csv.DictReader(f)
    for row in r:
        if row.get("date_utc")==today:
            rows.append((row.get("date_utc"), row.get("tld")))
c=Counter(rows)
dupes=[k for k,v in c.items() if v>1]
print("today_rows =", len(rows))
print("duplicate_pairs =", len(dupes))
if dupes[:10]:
    print("examples:", dupes[:10])
PY

D) NO RAW ZONES (after running live, still ensure NO zone files end up tracked)
  git status
  git ls-files | grep -E "\.(gz|zone|txt\.gz)$" && echo "FAIL: tracked raw zones" || echo "OK: no tracked raw zones"

If any LIVE check fails, the agent is not “done”.

LIVE
