#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd

from rootfetch.signals.model_v1 import compute_model_v1_from_growth


def _normalize_tld(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text.startswith("."):
        text = text[1:]
    return text


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
    except Exception:
        return None
    if out != out:  # NaN
        return None
    return out


def _rows_from_snapshot(snapshot: dict[str, Any], date_utc: str) -> list[dict[str, Any]]:
    raw_rows = snapshot.get("rows")
    if not isinstance(raw_rows, list):
        raw_rows = snapshot.get("market_map")
    if not isinstance(raw_rows, list):
        raw_rows = []

    rows: list[dict[str, Any]] = []
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        tld = _normalize_tld(row.get("tld"))
        if not tld:
            continue
        count = _to_float(row.get("count"))
        if count is None:
            continue
        delta_abs = _to_float(row.get("delta_abs"))
        prev_count = _to_float(row.get("prev_count"))
        if delta_abs is None and prev_count is not None:
            delta_abs = count - prev_count
        if delta_abs is None:
            delta_abs = 0.0
        delta_pct = _to_float(row.get("delta_pct"))
        if delta_pct is None:
            if prev_count is not None and prev_count > 0:
                delta_pct = delta_abs / prev_count
            else:
                delta_pct = 0.0
        rows.append(
            {
                "date_utc": date_utc,
                "tld": tld,
                "status": str(row.get("status") or "ok").strip().lower(),
                "count_num": count,
                "delta_abs_num": delta_abs,
                "delta_pct_num": delta_pct,
            }
        )
    return rows


def _load_history(payload: dict[str, Any]) -> tuple[pd.DataFrame, str, int]:
    history = payload.get("history")
    snapshots: list[dict[str, Any]]
    if isinstance(history, list) and history:
        snapshots = [item for item in history if isinstance(item, dict)]
    else:
        snapshots = [payload]

    all_rows: list[dict[str, Any]] = []
    target_date = ""
    approved_count = 0
    for idx, snapshot in enumerate(snapshots):
        date_utc = str(snapshot.get("date_utc") or "").strip()
        if not date_utc:
            raise RuntimeError(f"snapshot[{idx}] is missing date_utc")
        rows = _rows_from_snapshot(snapshot, date_utc)
        all_rows.extend(rows)
        if idx == len(snapshots) - 1:
            target_date = date_utc
            approved_count = int(snapshot.get("approved_tlds_count") or snapshot.get("count") or 0)
            if approved_count <= 0:
                approved_count = len(rows)

    frame = pd.DataFrame(all_rows)
    if frame.empty:
        frame = pd.DataFrame(
            columns=["date_utc", "tld", "status", "count_num", "delta_abs_num", "delta_pct_num"]
        )
    return frame, target_date, approved_count


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic RootFetch model v1 computation")
    parser.add_argument("snapshot_path", type=Path, help="Path to snapshot JSON")
    parser.add_argument("--date", default=None, help="Override target date_utc")
    args = parser.parse_args()

    payload = json.loads(args.snapshot_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Snapshot JSON must be an object")

    history_df, auto_date, approved_count = _load_history(payload)
    target_date = str(args.date or auto_date).strip()
    if not target_date:
        raise RuntimeError("No date_utc found. Provide --date or include date_utc in snapshot payload.")

    result = compute_model_v1_from_growth(
        growth_df=history_df,
        date_utc=target_date,
        approved_tlds_count=approved_count,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
