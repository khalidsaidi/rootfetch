#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: str) -> datetime | None:
    try:
        normalized = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _count_markdown_briefs(briefs_dir: Path, year: int) -> int:
    if not briefs_dir.exists():
        return 0
    count = 0
    for path in briefs_dir.glob("*.md"):
        name = path.name.lower()
        if not name.startswith(f"{year}-"):
            continue
        if "brief" in name or "update" in name or "bulletin" in name:
            count += 1
    return count


def _count_csv_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        rows = list(reader)
    # Header-only file counts as zero entries.
    return max(0, len(rows) - 1)


@dataclass
class WindowStats:
    days: int
    run_count: int
    max_gap_hours: float


def _window_stats(run_times: list[datetime], now: datetime, days: int) -> WindowStats:
    cutoff = now - timedelta(days=days)
    window = [ts for ts in run_times if ts >= cutoff]
    if len(window) < 2:
        return WindowStats(days=days, run_count=len(window), max_gap_hours=0.0)

    sorted_ts = sorted(window)
    max_gap = 0.0
    prev = sorted_ts[0]
    for ts in sorted_ts[1:]:
        gap = (ts - prev).total_seconds() / 3600.0
        if gap > max_gap:
            max_gap = gap
        prev = ts
    return WindowStats(days=days, run_count=len(window), max_gap_hours=round(max_gap, 2))


def build_scoreboard(repo_root: Path) -> dict[str, Any]:
    replay_index_path = repo_root / "data" / "artifacts" / "replay" / "index.json"
    briefs_dir = repo_root / "docs" / "briefs"
    ops_dir = repo_root / "data" / "ops"
    citations_log = ops_dir / "external_citations_log.csv"
    drill_log = ops_dir / "drill_log.csv"
    adoption_log = ops_dir / "adoption_log.csv"

    replay = _read_json(replay_index_path, {"runs": []})
    runs = replay.get("runs", []) if isinstance(replay, dict) else []
    parsed_runs: list[dict[str, Any]] = []
    run_times: list[datetime] = []

    for row in runs:
        if not isinstance(row, dict):
            continue
        ts = _parse_ts(str(row.get("snapshot_ts_utc") or ""))
        if ts is None:
            continue
        parsed_runs.append({"run_id": str(row.get("run_id") or ""), "snapshot_ts_utc": ts.isoformat()})
        run_times.append(ts)

    run_times.sort(reverse=True)
    now = run_times[0] if run_times else _utc_now()
    latest_ts = run_times[0] if run_times else None
    latest_run_age_hours = 0.0
    if latest_ts is not None:
        latest_run_age_hours = round((_utc_now() - latest_ts).total_seconds() / 3600.0, 2)

    win7 = _window_stats(run_times, now, 7)
    win30 = _window_stats(run_times, now, 30)
    year = now.year

    briefs_count = _count_markdown_briefs(briefs_dir, year)
    citation_count = _count_csv_rows(citations_log)
    drill_count = _count_csv_rows(drill_log)
    adoption_count = _count_csv_rows(adoption_log)

    return {
        "generated_at_utc": _utc_now().isoformat().replace("+00:00", "Z"),
        "reference_now_utc": now.isoformat().replace("+00:00", "Z"),
        "run_reliability": {
            "latest_run_age_hours": latest_run_age_hours,
            "runs_7d": win7.run_count,
            "runs_30d": win30.run_count,
            "max_gap_hours_7d": win7.max_gap_hours,
            "max_gap_hours_30d": win30.max_gap_hours,
        },
        "publication_cadence": {
            "briefs_published_ytd": briefs_count,
            "drills_logged_ytd": drill_count,
        },
        "adoption": {
            "external_citations_logged_ytd": citation_count,
            "adoption_log_entries_ytd": adoption_count,
            "note": "adoption and citation logs are operator-maintained csv files in data/ops/",
        },
        "targets_90d": {
            "run_completion_rate_pct": 99,
            "design_partner_teams": 10,
            "external_citations": 30,
            "weekly_active_mcp_clients": 10,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build RootFetch ops scoreboard artifact.")
    parser.add_argument("--repo-root", default=None, help="Path to repository root (default: auto-detect).")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve() if args.repo_root else Path(__file__).resolve().parents[1]
    ops_dir = repo_root / "data" / "ops"
    ops_dir.mkdir(parents=True, exist_ok=True)

    scoreboard = build_scoreboard(repo_root)
    out_path = ops_dir / "scoreboard_latest.json"
    out_path.write_text(json.dumps(scoreboard, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"scoreboard_path": str(out_path), "generated_at_utc": scoreboard["generated_at_utc"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
