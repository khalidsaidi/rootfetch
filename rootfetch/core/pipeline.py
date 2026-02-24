from __future__ import annotations

import csv
import gzip
import io
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.auth import get_access_token
from rootfetch.core.discovery import fetch_approved_links, write_discovery_artifacts
from rootfetch.core.io_utils import ensure_dir, utc_now_iso, utc_today_str
from rootfetch.core.logging_utils import setup_logger
from rootfetch.core.zone_count import parse_zone_metrics
from rootfetch.signals.compute import compute_signals_for_date
from rootfetch.signals.digest import write_daily_digest


DAILY_COUNTS_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "is_estimate",
    "source",
    "fetched_at_utc",
    "notes",
    "count_mode",
    "count_ds_sld",
    "count_glue_hosts",
    "count_ns_rr",
    "bytes_downloaded",
    "fetch_seconds",
    "status",
    "error",
]

GROWTH_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "delta_abs",
    "delta_pct",
    "is_estimate",
    "approved_today",
    "run_id",
    "fetched_at_utc",
    "count_mode",
    "status",
]


class TransientFetchError(RuntimeError):
    """Retryable fetch error."""


@dataclass
class RunResult:
    date_utc: str
    run_id: str
    selected_tlds: list[str]
    processed_tlds: list[str]
    failed_tlds: list[str]
    outputs: dict[str, str]


class _CountingReader:
    def __init__(self, raw: Any):
        self.raw = raw
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        data = self.raw.read(size)
        if data:
            self.bytes_read += len(data)
        return data

    def readable(self) -> bool:
        return True

    def close(self) -> None:
        try:
            self.raw.close()
        except Exception:
            pass

    def __getattr__(self, name: str) -> Any:
        return getattr(self.raw, name)


def _is_transient_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code <= 599


def _daily_counts_path(settings: Settings, date_utc: str) -> Path:
    return settings.daily_counts_dir / f"{date_utc}.csv"


def _read_daily_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _write_daily_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=DAILY_COUNTS_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _apply_tld_filters(links: list[dict[str, str]], settings: Settings) -> list[dict[str, str]]:
    out = []
    for item in links:
        tld = item["tld"].lower()
        if settings.allowlist and tld not in settings.allowlist:
            continue
        if tld in settings.blocklist:
            continue
        out.append({"tld": tld, "url": item["url"]})
    out.sort(key=lambda item: item["tld"])
    return out


def _sleep_backoff(attempt: int) -> None:
    base = min(2**attempt, 32)
    jitter = random.uniform(0.0, 1.0)
    time.sleep(base + jitter)


def _download_and_count(url: str, tld: str, settings: Settings) -> dict[str, Any]:
    started = time.monotonic()
    fetched_at = utc_now_iso()
    last_error = ""
    for attempt in range(settings.retry_max + 1):
        response = None
        try:
            response = requests.get(url, stream=True, timeout=settings.http_timeout)
            if _is_transient_status(response.status_code):
                raise TransientFetchError(f"HTTP {response.status_code}")
            if response.status_code >= 400:
                return {
                    "tld": tld,
                    "count_ns_sld": None,
                    "count_ds_sld": None,
                    "count_glue_hosts": None,
                    "count_ns_rr": None,
                    "is_estimate": settings.count_mode == "ns_sld_hll",
                    "count_mode": settings.count_mode,
                    "bytes_downloaded": 0,
                    "fetch_seconds": round(time.monotonic() - started, 3),
                    "fetched_at_utc": fetched_at,
                    "status": "failed",
                    "error": f"http_{response.status_code}",
                }

            response.raw.decode_content = False
            counter = _CountingReader(response.raw)
            content_type = response.headers.get("Content-Type", "").lower()
            content_encoding = response.headers.get("Content-Encoding", "").lower()
            looks_gzip = url.lower().endswith(".gz") or "gzip" in content_type or "gzip" in content_encoding

            binary_stream: Any = counter
            if looks_gzip:
                binary_stream = gzip.GzipFile(fileobj=counter)

            text_stream = io.TextIOWrapper(binary_stream, encoding="utf-8", errors="replace")
            metrics = parse_zone_metrics(text_stream, tld=tld, count_mode=settings.count_mode)
            text_stream.close()

            return {
                "tld": tld,
                "count_ns_sld": int(metrics["count_ns_sld"]),
                "count_ds_sld": int(metrics["count_ds_sld"]),
                "count_glue_hosts": int(metrics["count_glue_hosts"]),
                "count_ns_rr": int(metrics["count_ns_rr"]),
                "is_estimate": bool(metrics["is_estimate"]),
                "count_mode": metrics["count_mode"],
                "bytes_downloaded": int(counter.bytes_read),
                "fetch_seconds": round(time.monotonic() - started, 3),
                "fetched_at_utc": fetched_at,
                "status": "ok",
                "error": "",
            }
        except (requests.Timeout, requests.ConnectionError, TransientFetchError, OSError) as exc:
            last_error = str(exc)
            if attempt < settings.retry_max:
                _sleep_backoff(attempt)
                continue
            return {
                "tld": tld,
                "count_ns_sld": None,
                "count_ds_sld": None,
                "count_glue_hosts": None,
                "count_ns_rr": None,
                "is_estimate": settings.count_mode == "ns_sld_hll",
                "count_mode": settings.count_mode,
                "bytes_downloaded": 0,
                "fetch_seconds": round(time.monotonic() - started, 3),
                "fetched_at_utc": fetched_at,
                "status": "failed",
                "error": last_error[:200],
            }
        finally:
            if response is not None:
                response.close()
    return {
        "tld": tld,
        "count_ns_sld": None,
        "count_ds_sld": None,
        "count_glue_hosts": None,
        "count_ns_rr": None,
        "is_estimate": settings.count_mode == "ns_sld_hll",
        "count_mode": settings.count_mode,
        "bytes_downloaded": 0,
        "fetch_seconds": round(time.monotonic() - started, 3),
        "fetched_at_utc": fetched_at,
        "status": "failed",
        "error": last_error[:200],
    }


def _as_daily_row(date_utc: str, metric: dict[str, Any]) -> dict[str, Any]:
    return {
        "date_utc": date_utc,
        "tld": metric["tld"],
        "count": metric["count_ns_sld"] if metric["count_ns_sld"] is not None else "",
        "is_estimate": str(bool(metric["is_estimate"])).lower(),
        "source": "czds_zone",
        "fetched_at_utc": metric["fetched_at_utc"],
        "notes": "",
        "count_mode": metric["count_mode"],
        "count_ds_sld": metric["count_ds_sld"] if metric["count_ds_sld"] is not None else "",
        "count_glue_hosts": metric["count_glue_hosts"] if metric["count_glue_hosts"] is not None else "",
        "count_ns_rr": metric["count_ns_rr"] if metric["count_ns_rr"] is not None else "",
        "bytes_downloaded": metric["bytes_downloaded"],
        "fetch_seconds": metric["fetch_seconds"],
        "status": metric["status"],
        "error": metric["error"],
    }


def _safe_float(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_growth_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _last_known_counts(growth_rows: Iterable[dict[str, str]]) -> dict[str, float]:
    latest: dict[str, tuple[str, float]] = {}
    for row in growth_rows:
        if row.get("status") != "ok":
            continue
        count = _safe_float(row.get("count"))
        if count is None:
            continue
        tld = str(row.get("tld", "")).lower()
        date_utc = str(row.get("date_utc", ""))
        old = latest.get(tld)
        if old is None or date_utc >= old[0]:
            latest[tld] = (date_utc, count)
    return {tld: pair[1] for tld, pair in latest.items()}


def _write_growth_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=GROWTH_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _update_growth_trends(
    date_utc: str,
    daily_rows: list[dict[str, Any]],
    newly_approved: set[str],
    run_id: str,
    settings: Settings,
) -> Path:
    existing_rows = _load_growth_rows(settings.growth_trends_path)
    existing_rows = [
        row for row in existing_rows if not (row.get("date_utc") == date_utc and row.get("tld") in {r["tld"] for r in daily_rows})
    ]
    last_counts = _last_known_counts(existing_rows)

    new_rows: list[dict[str, Any]] = []
    for row in sorted(daily_rows, key=lambda item: item["tld"]):
        tld = row["tld"]
        count = _safe_float(row.get("count"))
        prev = last_counts.get(tld)
        delta_abs = None
        delta_pct = None
        if row.get("status") == "ok" and count is not None and prev is not None:
            delta_abs = count - prev
            if prev != 0:
                delta_pct = delta_abs / prev

        growth_row = {
            "date_utc": date_utc,
            "tld": tld,
            "count": "" if count is None else int(round(count)),
            "delta_abs": "" if delta_abs is None else delta_abs,
            "delta_pct": "" if delta_pct is None else delta_pct,
            "is_estimate": row.get("is_estimate", "false"),
            "approved_today": str(tld in newly_approved).lower(),
            "run_id": run_id,
            "fetched_at_utc": row.get("fetched_at_utc", ""),
            "count_mode": row.get("count_mode", settings.count_mode),
            "status": row.get("status", ""),
        }
        new_rows.append(growth_row)
        if row.get("status") == "ok" and count is not None:
            last_counts[tld] = count

    combined = existing_rows + new_rows
    combined.sort(key=lambda r: (r.get("date_utc", ""), r.get("tld", "")))
    _write_growth_rows(settings.growth_trends_path, combined)
    return settings.growth_trends_path


def run_daily(
    date_utc: str | None = None,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    settings: Settings | None = None,
) -> RunResult:
    settings = settings or get_settings()
    date_utc = date_utc or utc_today_str()
    run_id = str(uuid.uuid4())
    log_path = settings.logs_dir / f"run_{date_utc}.log"
    logger = setup_logger("rootfetch.pipeline", log_path=log_path, verbose=verbose)

    ensure_dir(settings.daily_counts_dir)
    ensure_dir(settings.approved_dir)
    ensure_dir(settings.signals_dir)
    ensure_dir(settings.logs_dir)
    ensure_dir(settings.snapshots_dir)

    token = get_access_token(settings=settings, dry_run=dry_run)
    approved_links = fetch_approved_links(token, settings=settings, dry_run=dry_run)
    discovery_meta = write_discovery_artifacts(approved_links, date_utc=date_utc, settings=settings)

    selected_links = _apply_tld_filters(approved_links, settings)
    selected_tlds = [item["tld"] for item in selected_links]
    logger.info("selected %s tlds after filters", len(selected_tlds))

    daily_path = _daily_counts_path(settings, date_utc)
    existing_rows = _read_daily_rows(daily_path)
    existing_by_tld = {row["tld"]: row for row in existing_rows if row.get("tld")}
    pending_links = [item for item in selected_links if item["tld"] not in existing_by_tld]

    processed_rows: list[dict[str, Any]] = [existing_by_tld[tld] for tld in sorted(existing_by_tld) if tld in selected_tlds]
    if pending_links:
        with ThreadPoolExecutor(max_workers=settings.max_workers) as executor:
            future_map = {executor.submit(_download_and_count, item["url"], item["tld"], settings): item for item in pending_links}
            for future in as_completed(future_map):
                item = future_map[future]
                metric = future.result()
                processed_rows.append(_as_daily_row(date_utc, metric))
                logger.info("processed tld=%s status=%s", item["tld"], metric["status"])

    processed_rows = [row for row in processed_rows if row.get("tld") in set(selected_tlds)]
    processed_rows.sort(key=lambda row: row["tld"])
    _write_daily_rows(daily_path, processed_rows)

    growth_path = _update_growth_trends(
        date_utc,
        processed_rows,
        set(discovery_meta["newly_approved"]),
        run_id,
        settings,
    )

    signal_meta = compute_signals_for_date(date_utc, run_id=run_id, settings=settings)
    digest_meta = write_daily_digest(date_utc, run_id=run_id, settings=settings)

    failed_tlds = [row["tld"] for row in processed_rows if row.get("status") == "failed"]
    return RunResult(
        date_utc=date_utc,
        run_id=run_id,
        selected_tlds=selected_tlds,
        processed_tlds=[row["tld"] for row in processed_rows],
        failed_tlds=failed_tlds,
        outputs={
            "daily_counts": str(daily_path),
            "growth_trends": str(growth_path),
            "top_movers": str(signal_meta["top_movers_path"]),
            "volatility": str(signal_meta["volatility_path"]),
            "anomalies": str(signal_meta["anomalies_path"]),
            "sector_indices": str(signal_meta["sector_indices_path"]),
            "latest": str(signal_meta["latest_path"]),
            "digest": str(digest_meta["dated_digest_path"]),
        },
    )


def run_discovery_only(*, date_utc: str | None = None, dry_run: bool = False, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    date_utc = date_utc or utc_today_str()
    token = get_access_token(settings=settings, dry_run=dry_run)
    links = fetch_approved_links(token, settings=settings, dry_run=dry_run)
    return write_discovery_artifacts(links, date_utc=date_utc, settings=settings)
