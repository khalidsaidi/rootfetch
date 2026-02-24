from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json, write_json


def _normalize_tld_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    tlds = {str(value).strip().lower() for value in values if str(value).strip()}
    return sorted(tlds)


def _load_approved_latest(settings: Settings, date_utc: str) -> dict[str, Any]:
    latest_path = settings.approved_dir / "latest.json"
    dated_path = settings.approved_dir / f"{date_utc}.json"
    source_path = latest_path if latest_path.exists() else dated_path
    if not source_path.exists():
        return {
            "date_utc": date_utc,
            "approved_tlds": [],
        }

    payload = read_json(source_path)
    if not isinstance(payload, dict):
        return {
            "date_utc": date_utc,
            "approved_tlds": [],
        }

    approved_tlds = _normalize_tld_list(payload.get("tlds", []))
    payload_date = str(payload.get("date_utc") or date_utc)
    return {
        "date_utc": payload_date,
        "approved_tlds": approved_tlds,
    }


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _load_counted_today(settings: Settings, date_utc: str) -> list[str]:
    rows = _read_csv_rows(settings.daily_counts_dir / f"{date_utc}.csv")
    tlds = {
        str(row.get("tld", "")).strip().lower()
        for row in rows
        if str(row.get("status", "")).strip().lower() == "ok" and str(row.get("tld", "")).strip()
    }
    return sorted(tlds)


def _load_counted_today_by_cadence(settings: Settings, date_utc: str) -> dict[str, list[str]]:
    rows = _read_csv_rows(settings.daily_counts_dir / f"{date_utc}.csv")
    by_cadence: dict[str, set[str]] = {"core": set(), "rolling": set()}
    for row in rows:
        if str(row.get("status", "")).strip().lower() != "ok":
            continue
        tld = str(row.get("tld", "")).strip().lower()
        if not tld:
            continue
        cadence = str(row.get("cadence", "")).strip().lower()
        if cadence in by_cadence:
            by_cadence[cadence].add(tld)
    return {key: sorted(values) for key, values in by_cadence.items()}


def _has_count_value(value: Any) -> bool:
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    try:
        float(text)
        return True
    except ValueError:
        return False


def _load_counted_ever(settings: Settings) -> list[str]:
    rows = _read_csv_rows(settings.growth_trends_path)
    tlds: set[str] = set()
    for row in rows:
        tld = str(row.get("tld", "")).strip().lower()
        if not tld:
            continue
        status_ok = str(row.get("status", "")).strip().lower() == "ok"
        if status_ok or _has_count_value(row.get("count")):
            tlds.add(tld)
    return sorted(tlds)


def _load_last_seen_by_tld(settings: Settings) -> dict[str, str]:
    rows = _read_csv_rows(settings.growth_trends_path)
    out: dict[str, str] = {}
    for row in rows:
        status = str(row.get("status", "")).strip().lower()
        if status != "ok":
            continue
        tld = str(row.get("tld", "")).strip().lower()
        date_utc = str(row.get("date_utc", "")).strip()
        if not tld or not date_utc:
            continue
        previous = out.get(tld)
        if previous is None or date_utc > previous:
            out[tld] = date_utc
    return out


def compute_coverage_latest(date_utc: str, *, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    settings.signals_dir.mkdir(parents=True, exist_ok=True)

    approved_info = _load_approved_latest(settings, date_utc)
    resolved_date = approved_info["date_utc"]
    approved_tlds = approved_info["approved_tlds"]
    approved_set = set(approved_tlds)

    counted_today_tlds = _load_counted_today(settings, resolved_date)
    counted_today_by_cadence = _load_counted_today_by_cadence(settings, resolved_date)
    counted_ever_tlds = _load_counted_ever(settings)
    last_seen_by_tld = _load_last_seen_by_tld(settings)

    # Keep coverage anchored to approved TLD universe.
    counted_today_tlds = sorted(set(counted_today_tlds) & approved_set)
    counted_ever_tlds = sorted(set(counted_ever_tlds) & approved_set)

    missing_ever_tlds = sorted(approved_set - set(counted_ever_tlds))

    coverage_payload = {
        "date_utc": resolved_date,
        "approved_tlds_count": len(approved_tlds),
        "approved_tlds": approved_tlds,
        "counted_today_tlds": counted_today_tlds,
        "counted_today_count": len(counted_today_tlds),
        "counted_today_core_tlds": counted_today_by_cadence["core"],
        "counted_today_core_count": len(counted_today_by_cadence["core"]),
        "counted_today_rolling_tlds": counted_today_by_cadence["rolling"],
        "counted_today_rolling_count": len(counted_today_by_cadence["rolling"]),
        "counted_ever_tlds": counted_ever_tlds,
        "counted_ever_count": len(counted_ever_tlds),
        "missing_ever_tlds": missing_ever_tlds,
        "missing_ever_count": len(missing_ever_tlds),
        "last_seen_by_tld": {
            tld: last_seen_by_tld[tld]
            for tld in approved_tlds
            if tld in last_seen_by_tld
        },
    }

    coverage_path = settings.signals_dir / "coverage_latest.json"
    write_json(coverage_path, coverage_payload)

    return {
        "coverage_path": coverage_path,
        "coverage_payload": coverage_payload,
    }
