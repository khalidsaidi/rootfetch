from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json, utc_now_iso, write_json

DISCOVERY_URL = "https://czds-api.icann.org/czds/downloads/links"


def _extract_tld_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    filename = Path(parsed.path).name.lower()
    if not filename:
        return None
    candidate = filename
    for suffix in (".zone.gz", ".txt.gz", ".gz", ".zone", ".txt"):
        if candidate.endswith(suffix):
            candidate = candidate[: -len(suffix)]
            break
    candidate = candidate.strip(".")
    if not candidate:
        return None
    return candidate


def _normalize_item(item: Any) -> dict[str, str] | None:
    if isinstance(item, str):
        tld = _extract_tld_from_url(item)
        if not tld:
            return None
        return {"tld": tld, "url": item}

    if not isinstance(item, dict):
        return None

    url = ""
    for key in ("url", "downloadUrl", "downloadURL", "link", "href"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            url = value.strip()
            break

    tld = item.get("tld")
    if isinstance(tld, str):
        tld = tld.strip(". ").lower()
    else:
        tld = None

    if not tld and url:
        tld = _extract_tld_from_url(url)

    if not tld or not url:
        return None
    return {"tld": tld, "url": url}


def _extract_items_from_response(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("links", "downloadLinks", "urls", "data", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def fetch_approved_links(token: str, *, settings: Settings | None = None, dry_run: bool = False) -> list[dict[str, str]]:
    settings = settings or get_settings()
    if dry_run:
        if settings.approved_snapshot_path.exists():
            snapshot = read_json(settings.approved_snapshot_path)
            if isinstance(snapshot, dict):
                links = snapshot.get("links")
                if isinstance(links, list):
                    return [item for item in links if isinstance(item, dict) and "tld" in item and "url" in item]
        return []

    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(DISCOVERY_URL, headers=headers, timeout=settings.http_timeout)
    response.raise_for_status()

    payload: Any
    try:
        payload = response.json()
    except ValueError:
        payload = [line.strip() for line in response.text.splitlines() if line.strip()]

    raw_items = _extract_items_from_response(payload)
    if not raw_items and isinstance(payload, list):
        raw_items = payload

    normalized: list[dict[str, str]] = []
    seen_tlds: set[str] = set()
    for raw_item in raw_items:
        item = _normalize_item(raw_item)
        if not item:
            continue
        tld = item["tld"].lower()
        if tld in seen_tlds:
            continue
        seen_tlds.add(tld)
        normalized.append({"tld": tld, "url": item["url"]})
    normalized.sort(key=lambda record: record["tld"])
    return normalized


def _find_previous_approved_file(settings: Settings, current_date: str) -> Path | None:
    if not settings.approved_dir.exists():
        return None
    candidates = sorted(path for path in settings.approved_dir.glob("*.json") if path.stem < current_date)
    return candidates[-1] if candidates else None


def _read_tld_set(path: Path | None) -> set[str]:
    if not path or not path.exists():
        return set()
    payload = read_json(path)
    if not isinstance(payload, dict):
        return set()
    tlds = payload.get("tlds", [])
    if not isinstance(tlds, list):
        return set()
    return {str(tld).strip().lower() for tld in tlds if str(tld).strip()}


def write_discovery_artifacts(
    links: list[dict[str, str]],
    *,
    date_utc: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    fetched_at = utc_now_iso()
    settings.approved_snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    settings.approved_dir.mkdir(parents=True, exist_ok=True)
    settings.snapshots_dir.mkdir(parents=True, exist_ok=True)

    internal_snapshot = {
        "date_utc": date_utc,
        "fetched_at_utc": fetched_at,
        "count": len(links),
        "links": links,
    }
    write_json(settings.approved_snapshot_path, internal_snapshot)

    tlds = sorted({item["tld"] for item in links})
    sanitized = {
        "date_utc": date_utc,
        "fetched_at_utc": fetched_at,
        "count": len(tlds),
        "tlds": tlds,
    }
    sanitized_path = settings.approved_dir / f"{date_utc}.json"
    write_json(sanitized_path, sanitized)

    previous_file = _find_previous_approved_file(settings, date_utc)
    previous_tlds = _read_tld_set(previous_file)
    today_tlds = set(tlds)
    newly_approved = sorted(today_tlds - previous_tlds)
    removed = sorted(previous_tlds - today_tlds)
    diff_payload = {
        "date_utc": date_utc,
        "fetched_at_utc": fetched_at,
        "previous_file": previous_file.name if previous_file else None,
        "newly_approved": newly_approved,
        "removed": removed,
    }
    diff_path = settings.snapshots_dir / f"approved_diff_{date_utc}.json"
    write_json(diff_path, diff_payload)

    return {
        "sanitized_path": sanitized_path,
        "internal_snapshot_path": settings.approved_snapshot_path,
        "diff_path": diff_path,
        "newly_approved": newly_approved,
        "removed": removed,
        "tlds": tlds,
    }
