#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from rootfetch.config import get_settings
from rootfetch.core.auth import get_access_token
from rootfetch.core.discovery import fetch_approved_links
from rootfetch.core.pipeline import _download_and_count


def _parse_tlds(raw: str) -> list[str]:
    return sorted({part.strip().lower() for part in raw.split(",") if part.strip()})


def _safe_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value)))
    except Exception:
        return None


def _load_stored_rows(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"daily counts not found: {path}")
    with path.open("r", newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    return {str(row.get("tld", "")).strip().lower(): row for row in rows if str(row.get("tld", "")).strip()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="UTC date (YYYY-MM-DD)")
    parser.add_argument("--tlds", required=True, help="Comma-separated TLDs")
    args = parser.parse_args()

    tlds = _parse_tlds(args.tlds)
    if not tlds:
        raise SystemExit("no tlds provided")

    settings = get_settings()
    stored_path = settings.daily_counts_dir / f"{args.date}.csv"
    stored_rows = _load_stored_rows(stored_path)

    missing_stored = [tld for tld in tlds if tld not in stored_rows]
    if missing_stored:
        print(json.dumps({"error": "tlds_missing_in_daily_counts", "tlds": missing_stored}, indent=2))
        return 2

    token = get_access_token(settings=settings, dry_run=False)
    links = fetch_approved_links(token, settings=settings, dry_run=False)
    url_by_tld = {item["tld"]: item["url"] for item in links}

    missing_url = [tld for tld in tlds if tld not in url_by_tld]
    if missing_url:
        print(json.dumps({"error": "tlds_missing_download_links", "tlds": missing_url}, indent=2))
        return 2

    out_rows: list[dict[str, Any]] = []
    max_workers = max(1, min(settings.max_workers, len(tlds)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_download_and_count, url_by_tld[tld], tld, token, settings): tld
            for tld in tlds
        }
        for future in as_completed(future_map):
            tld = future_map[future]
            metric = future.result()
            stored = stored_rows[tld]
            stored_count = _safe_int(stored.get("count"))
            recounted = _safe_int(metric.get("count_ns_sld"))
            delta = None if stored_count is None or recounted is None else recounted - stored_count
            match = bool(metric.get("status") == "ok" and delta == 0)
            out_rows.append(
                {
                    "tld": tld,
                    "stored_status": str(stored.get("status", "")).strip().lower(),
                    "recount_status": str(metric.get("status", "")).strip().lower(),
                    "stored_count": stored_count,
                    "recounted_count": recounted,
                    "delta": delta,
                    "match": match,
                    "bytes_downloaded": _safe_int(metric.get("bytes_downloaded")) or 0,
                    "fetch_seconds": metric.get("fetch_seconds"),
                    "error": metric.get("error", ""),
                }
            )

    out_rows.sort(key=lambda row: row["tld"])
    fetch_failures = [row for row in out_rows if row["recount_status"] != "ok"]
    matches = [row for row in out_rows if row["match"]]
    mismatches = [row for row in out_rows if row["recount_status"] == "ok" and not row["match"]]

    print(
        json.dumps(
            {
                "date_utc": args.date,
                "sample_count": len(tlds),
                "match_count": len(matches),
                "mismatch_count": len(mismatches),
                "fetch_failures_count": len(fetch_failures),
                "rows": out_rows,
            },
            indent=2,
        )
    )

    if fetch_failures:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
