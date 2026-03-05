from __future__ import annotations

import csv
import gzip
import io
import random
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.auth import get_access_token
from rootfetch.core.discovery import fetch_approved_links, write_discovery_artifacts
from rootfetch.core.hybrid_select import select_hybrid_tlds
from rootfetch.core.io_utils import ensure_dir, read_json, utc_now_iso, utc_today_str, write_json
from rootfetch.core.logging_utils import setup_logger
from rootfetch.core.zone_count import parse_zone_metrics
from rootfetch.rag.static_build import build_static_rag
from rootfetch.signals.compute import compute_signals_for_date
from rootfetch.signals.coverage import compute_coverage_latest
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
    "cadence",
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
    "prev_date_utc",
    "days_since_prev",
    "cadence",
]

CADENCE_MIGRATION_MARKER = "cadence_migrated_v1.json"


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
    summary: dict[str, Any]


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


def _normalize_cadence(value: Any, *, fallback: str = "legacy") -> str:
    text = str(value or "").strip().lower()
    return text if text else fallback


def _normalize_daily_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {column: row.get(column, "") for column in DAILY_COUNTS_COLUMNS}
    out["date_utc"] = str(out.get("date_utc", "")).strip()
    out["tld"] = str(out.get("tld", "")).strip().lower()
    out["status"] = str(out.get("status", "")).strip().lower()
    out["cadence"] = _normalize_cadence(out.get("cadence"))
    return out


def _normalize_growth_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {column: row.get(column, "") for column in GROWTH_COLUMNS}
    out["date_utc"] = str(out.get("date_utc", "")).strip()
    out["tld"] = str(out.get("tld", "")).strip().lower()
    out["status"] = str(out.get("status", "")).strip().lower()
    out["cadence"] = _normalize_cadence(out.get("cadence"))
    return out


def _atomic_write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex}")
    with temp_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    temp_path.replace(path)


def _is_transient_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code <= 599


def _daily_counts_path(settings: Settings, date_utc: str) -> Path:
    return settings.daily_counts_dir / f"{date_utc}.csv"


def _read_daily_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
    return [_normalize_daily_row(row) for row in rows]


def _write_daily_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    normalized = [_normalize_daily_row(row) for row in rows]
    _atomic_write_csv(path, DAILY_COUNTS_COLUMNS, normalized)


def _load_growth_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
    return [_normalize_growth_row(row) for row in rows]


def _write_growth_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    normalized = [_normalize_growth_row(row) for row in rows]
    _atomic_write_csv(path, GROWTH_COLUMNS, normalized)


def _migrate_daily_file_cadence(path: Path) -> bool:
    if not path.exists():
        return False
    with path.open("r", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    changed = "cadence" not in fieldnames
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized = _normalize_daily_row(row)
        old = str(row.get("cadence", "")).strip().lower()
        if normalized["cadence"] != old:
            changed = True
        normalized_rows.append(normalized)

    if changed:
        _write_daily_rows(path, normalized_rows)
    return changed


def _migrate_growth_file_cadence(path: Path) -> bool:
    if not path.exists():
        return False
    with path.open("r", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    changed = "cadence" not in fieldnames
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized = _normalize_growth_row(row)
        old = str(row.get("cadence", "")).strip().lower()
        if normalized["cadence"] != old:
            changed = True
        normalized_rows.append(normalized)

    if changed:
        _write_growth_rows(path, normalized_rows)
    return changed


def _migrate_legacy_cadence_once(settings: Settings) -> None:
    marker_path = settings.ai_dir / CADENCE_MIGRATION_MARKER
    if marker_path.exists():
        return

    ensure_dir(marker_path.parent)

    daily_files_touched = 0
    for path in sorted(settings.daily_counts_dir.glob("*.csv")):
        if _migrate_daily_file_cadence(path):
            daily_files_touched += 1

    growth_touched = _migrate_growth_file_cadence(settings.growth_trends_path)

    write_json(
        marker_path,
        {
            "migrated_at_utc": utc_now_iso(),
            "daily_files_touched": daily_files_touched,
            "growth_trends_touched": bool(growth_touched),
        },
    )


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


def _download_and_count(url: str, tld: str, token: str, settings: Settings) -> dict[str, Any]:
    started = time.monotonic()
    fetched_at = utc_now_iso()
    last_error = ""
    for attempt in range(settings.retry_max + 1):
        response = None
        try:
            response = requests.get(
                url,
                stream=True,
                timeout=settings.http_timeout,
                headers={"Authorization": f"Bearer {token}"},
            )
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


def _as_daily_row(date_utc: str, metric: dict[str, Any], cadence: str = "legacy") -> dict[str, Any]:
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
        "cadence": _normalize_cadence(cadence),
    }


def _safe_float(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _last_known_by_tld(growth_rows: Iterable[dict[str, Any]]) -> dict[str, tuple[str, float]]:
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
    return latest


def _days_between(prev_date_utc: str | None, current_date_utc: str) -> int | None:
    if not prev_date_utc:
        return None
    try:
        prev = date.fromisoformat(prev_date_utc)
        curr = date.fromisoformat(current_date_utc)
    except ValueError:
        return None
    return (curr - prev).days


def _update_growth_trends(
    date_utc: str,
    daily_rows: list[dict[str, Any]],
    newly_approved: set[str],
    run_id: str,
    settings: Settings,
) -> Path:
    existing_rows = _load_growth_rows(settings.growth_trends_path)
    target_tlds = {r["tld"] for r in daily_rows if r.get("tld")}
    existing_rows = [
        row for row in existing_rows if not (row.get("date_utc") == date_utc and row.get("tld") in target_tlds)
    ]
    last_by_tld = _last_known_by_tld(existing_rows)

    new_rows: list[dict[str, Any]] = []
    for row in sorted(daily_rows, key=lambda item: str(item.get("tld", ""))):
        tld = str(row.get("tld", "")).strip().lower()
        if not tld:
            continue
        count = _safe_float(row.get("count"))
        previous = last_by_tld.get(tld)
        prev_date_utc = previous[0] if previous else ""
        prev_count = previous[1] if previous else None

        days_since_prev = _days_between(prev_date_utc if prev_date_utc else None, date_utc)

        delta_abs = None
        delta_pct = None
        if row.get("status") == "ok" and count is not None and prev_count is not None:
            delta_abs = count - prev_count
            if prev_count != 0:
                delta_pct = delta_abs / prev_count

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
            "prev_date_utc": prev_date_utc,
            "days_since_prev": "" if days_since_prev is None else days_since_prev,
            "cadence": _normalize_cadence(row.get("cadence")),
        }
        new_rows.append(growth_row)
        if row.get("status") == "ok" and count is not None:
            last_by_tld[tld] = (date_utc, count)

    combined = existing_rows + new_rows
    combined.sort(key=lambda r: (r.get("date_utc", ""), r.get("tld", "")))
    _write_growth_rows(settings.growth_trends_path, combined)
    return settings.growth_trends_path


def _load_links_from_internal_snapshot(settings: Settings) -> list[dict[str, str]]:
    if not settings.approved_snapshot_path.exists():
        return []
    payload = read_json(settings.approved_snapshot_path)
    if not isinstance(payload, dict):
        return []
    links = payload.get("links", [])
    out: list[dict[str, str]] = []
    if isinstance(links, list):
        for item in links:
            if not isinstance(item, dict):
                continue
            tld = str(item.get("tld", "")).strip().lower()
            url = str(item.get("url", "")).strip()
            if tld and url:
                out.append({"tld": tld, "url": url})
    out.sort(key=lambda item: item["tld"])
    return out


def _load_approved_tlds_latest(settings: Settings) -> list[str]:
    latest_path = settings.approved_dir / "latest.json"
    if not latest_path.exists():
        return []
    payload = read_json(latest_path)
    if not isinstance(payload, dict):
        return []
    tlds = payload.get("tlds", [])
    if not isinstance(tlds, list):
        return []
    return sorted({str(tld).strip().lower() for tld in tlds if str(tld).strip()})


def _load_baseline_progress(settings: Settings) -> dict[str, Any]:
    if not settings.baseline_progress_path.exists():
        return {}
    payload = read_json(settings.baseline_progress_path)
    if isinstance(payload, dict):
        return payload
    return {}


def _save_baseline_progress(settings: Settings, *, baseline_date_utc: str, approved_count: int) -> None:
    progress = _load_baseline_progress(settings)
    first_started = str(progress.get("first_started_at_utc", "")).strip() or utc_now_iso()
    write_json(
        settings.baseline_progress_path,
        {
            "baseline_date_utc": baseline_date_utc,
            "first_started_at_utc": first_started,
            "last_resumed_at_utc": utc_now_iso(),
            "approved_count": int(approved_count),
        },
    )


def _clear_baseline_progress(settings: Settings) -> None:
    if settings.baseline_progress_path.exists():
        settings.baseline_progress_path.unlink()


def _resolve_baseline_date(
    *,
    date_utc: str | None,
    resume: bool,
    settings: Settings,
) -> str:
    if date_utc:
        return date_utc
    if resume:
        progress = _load_baseline_progress(settings)
        progress_date = str(progress.get("baseline_date_utc", "")).strip()
        if progress_date:
            return progress_date
    return utc_today_str()


def _normalize_tld_set(values: Any) -> set[str]:
    if not isinstance(values, list):
        return set()
    out: set[str] = set()
    for value in values:
        tld = str(value).strip().lower()
        if tld:
            out.add(tld)
    return out


def _count_ok_rows_for_tlds(rows: list[dict[str, Any]], tlds: set[str]) -> int:
    return sum(
        1
        for row in rows
        if row.get("tld") in tlds and str(row.get("status", "")).strip().lower() == "ok"
    )


def _read_coverage_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = read_json(path)
    if isinstance(payload, dict):
        return payload
    return {}


def baseline_completion_status(*, date_utc: str | None = None, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    target_date = date_utc or utc_today_str()
    coverage_meta = compute_coverage_latest(target_date, settings=settings)
    coverage_payload = coverage_meta["coverage_payload"]

    approved_count = int(coverage_payload.get("approved_tlds_count", 0))
    counted_ever_count = int(coverage_payload.get("counted_ever_count", 0))
    missing_ever_count = int(coverage_payload.get("missing_ever_count", 0))
    has_marker = settings.baseline_complete_path.exists()
    baseline_complete = bool(
        has_marker
        and approved_count > 0
        and approved_count == counted_ever_count
        and missing_ever_count == 0
    )

    return {
        "date_utc": str(coverage_payload.get("date_utc", target_date)),
        "has_marker": has_marker,
        "baseline_complete": baseline_complete,
        "approved_tlds_count": approved_count,
        "counted_ever_count": counted_ever_count,
        "missing_ever_count": missing_ever_count,
        "coverage_path": str(coverage_meta["coverage_path"]),
        "baseline_complete_path": str(settings.baseline_complete_path),
    }


def _write_baseline_complete_marker(*, baseline_date_utc: str, approved_count: int, settings: Settings) -> None:
    ensure_dir(settings.state_dir)
    write_json(
        settings.baseline_complete_path,
        {
            "completed_at_utc": utc_now_iso(),
            "baseline_date_utc": baseline_date_utc,
            "approved_count_at_completion": int(approved_count),
        },
    )


def _prepare_daily_rows_for_targets(
    *,
    date_utc: str,
    target_links: list[dict[str, str]],
    cadence_map: dict[str, str],
    token: str,
    settings: Settings,
    logger: Any,
) -> tuple[Path, list[dict[str, Any]], list[dict[str, Any]]]:
    daily_path = _daily_counts_path(settings, date_utc)
    existing_rows = _read_daily_rows(daily_path)
    existing_by_tld = {row["tld"]: row for row in existing_rows if row.get("tld")}

    pending_links: list[dict[str, str]] = []
    processed_rows: list[dict[str, Any]] = []
    for item in target_links:
        tld = item["tld"]
        cadence = _normalize_cadence(cadence_map.get(tld))
        existing = existing_by_tld.get(tld)
        if existing and existing.get("status") == "ok":
            existing = dict(existing)
            existing["cadence"] = cadence
            processed_rows.append(existing)
            continue
        pending_links.append(item)

    if pending_links:
        with ThreadPoolExecutor(max_workers=max(1, settings.max_workers)) as executor:
            future_map = {
                executor.submit(_download_and_count, item["url"], item["tld"], token, settings): item
                for item in pending_links
            }
            for future in as_completed(future_map):
                item = future_map[future]
                metric = future.result()
                cadence = _normalize_cadence(cadence_map.get(item["tld"]))
                processed_rows.append(_as_daily_row(date_utc, metric, cadence=cadence))
                logger.info("processed tld=%s status=%s cadence=%s", item["tld"], metric["status"], cadence)

    merged_rows: dict[str, dict[str, Any]] = {row["tld"]: row for row in existing_rows if row.get("tld")}
    for row in processed_rows:
        merged_rows[row["tld"]] = row

    rows_for_write = sorted(merged_rows.values(), key=lambda row: str(row.get("tld", "")))
    _write_daily_rows(daily_path, rows_for_write)
    return daily_path, rows_for_write, processed_rows


def _prepare_baseline_rows(
    *,
    date_utc: str,
    approved_tlds: list[str],
    target_links: list[dict[str, str]],
    progress_tlds: list[str],
    token: str,
    settings: Settings,
    logger: Any,
) -> tuple[Path, list[dict[str, Any]], list[dict[str, Any]]]:
    daily_path = _daily_counts_path(settings, date_utc)
    existing_rows = _read_daily_rows(daily_path)
    approved_set = set(approved_tlds)
    progress_set = set(progress_tlds) if progress_tlds else approved_set

    merged_rows: dict[str, dict[str, Any]] = {row["tld"]: row for row in existing_rows if row.get("tld")}
    for tld, row in list(merged_rows.items()):
        if tld in approved_set and str(row.get("status", "")).strip().lower() == "ok":
            updated = dict(row)
            updated["cadence"] = "baseline"
            merged_rows[tld] = updated

    pending_links = [
        item
        for item in target_links
        if not (
            merged_rows.get(item["tld"], {}).get("status") == "ok"
            and merged_rows.get(item["tld"], {}).get("tld") == item["tld"]
        )
    ]

    processed_rows: list[dict[str, Any]] = []
    log_every = max(1, settings.log_every)

    if pending_links:
        with ThreadPoolExecutor(max_workers=max(1, settings.max_workers)) as executor:
            future_map = {
                executor.submit(_download_and_count, item["url"], item["tld"], token, settings): item
                for item in pending_links
            }
            future_started_at = {future: time.monotonic() for future in future_map}
            completed = 0
            total_pending = len(pending_links)
            # For small delta runs, emit progress each completion to avoid long silent windows.
            dynamic_log_every = 1 if total_pending <= log_every else log_every
            pending_futures = set(future_map.keys())
            last_wait_log_at = time.monotonic()
            while pending_futures:
                done, pending_futures = wait(pending_futures, timeout=5, return_when=FIRST_COMPLETED)
                if not done:
                    now = time.monotonic()
                    if now - last_wait_log_at >= 30:
                        checkpoint_rows = sorted(merged_rows.values(), key=lambda r: str(r.get("tld", "")))
                        processed_ok = _count_ok_rows_for_tlds(checkpoint_rows, progress_set)
                        remaining = max(0, len(progress_set) - processed_ok)
                        in_flight_items = sorted(
                            ((future_map[f]["tld"], now - future_started_at.get(f, now)) for f in pending_futures),
                            key=lambda item: item[1],
                            reverse=True,
                        )
                        in_flight_preview = ", ".join(
                            f"{tld}:{int(seconds)}s" for tld, seconds in in_flight_items[:6]
                        )
                        logger.info(
                            "baseline waiting in_flight=%s processed_ok=%s remaining=%s attempted=%s/%s tlds=[%s]",
                            len(pending_futures),
                            processed_ok,
                            remaining,
                            completed,
                            total_pending,
                            in_flight_preview,
                        )
                        last_wait_log_at = now
                    continue

                for future in done:
                    item = future_map[future]
                    metric = future.result()
                    row = _as_daily_row(date_utc, metric, cadence="baseline")
                    merged_rows[item["tld"]] = row
                    processed_rows.append(row)
                    completed += 1

                    if completed % dynamic_log_every == 0 or completed == total_pending:
                        checkpoint_rows = sorted(merged_rows.values(), key=lambda r: str(r.get("tld", "")))
                        _write_daily_rows(daily_path, checkpoint_rows)
                        processed_ok = _count_ok_rows_for_tlds(checkpoint_rows, progress_set)
                        remaining = max(0, len(progress_set) - processed_ok)
                        logger.info(
                            "baseline progress processed_ok=%s remaining=%s attempted=%s/%s",
                            processed_ok,
                            remaining,
                            completed,
                            total_pending,
                        )

    rows_for_write = sorted(merged_rows.values(), key=lambda row: str(row.get("tld", "")))
    _write_daily_rows(daily_path, rows_for_write)
    return daily_path, rows_for_write, processed_rows


def _build_outputs(
    *,
    date_utc: str,
    run_id: str,
    selected_tlds: list[str],
    processed_rows: list[dict[str, Any]],
    daily_path: Path,
    growth_path: Path,
    signal_meta: dict[str, Any],
    digest_meta: dict[str, Any],
    summary: dict[str, Any],
) -> RunResult:
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
            "top_movers": str(signal_meta.get("top_movers_path", "")),
            "core_top_movers": str(signal_meta.get("core_top_movers_path", "")),
            "rolling_updates": str(signal_meta.get("rolling_updates_path", "")),
            "volatility": str(signal_meta.get("volatility_path", "")),
            "anomalies": str(signal_meta.get("anomalies_path", "")),
            "sector_indices": str(signal_meta.get("sector_indices_path", "")),
            "top_tlds": str(signal_meta.get("top_tlds_path", "")),
            "distribution": str(signal_meta.get("distribution_path", "")),
            "concentration": str(signal_meta.get("concentration_path", "")),
            "approvals_diff": str(signal_meta.get("approvals_diff_path", "")),
            "security_status": str(signal_meta.get("security_status_path", "")),
            "latest": str(signal_meta.get("latest_path", "")),
            "coverage": str(signal_meta.get("coverage_path", "")),
            "digest": str(digest_meta.get("dated_digest_path", "")),
            "rag_chunks": str(signal_meta.get("rag_chunks_path", "")),
            "rag_meta": str(signal_meta.get("rag_meta_path", "")),
        },
        summary=summary,
    )


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
    ensure_dir(settings.state_dir)

    if not dry_run:
        _migrate_legacy_cadence_once(settings)

    token = get_access_token(settings=settings, dry_run=dry_run)
    approved_links = fetch_approved_links(token, settings=settings, dry_run=dry_run)
    discovery_meta = write_discovery_artifacts(approved_links, date_utc=date_utc, settings=settings)

    selected_links = _apply_tld_filters(approved_links, settings)
    selected_tlds = [item["tld"] for item in selected_links]
    logger.info("selected %s tlds after filters", len(selected_tlds))

    if dry_run:
        summary = {
            "mode": "daily",
            "approved_count": len(discovery_meta.get("tlds", [])),
            "selected_count": len(selected_tlds),
        }
        return RunResult(
            date_utc=date_utc,
            run_id=run_id,
            selected_tlds=selected_tlds,
            processed_tlds=[],
            failed_tlds=[],
            outputs={},
            summary=summary,
        )

    cadence_map = {tld: "daily" for tld in selected_tlds}
    daily_path, _, processed_rows = _prepare_daily_rows_for_targets(
        date_utc=date_utc,
        target_links=selected_links,
        cadence_map=cadence_map,
        token=token,
        settings=settings,
        logger=logger,
    )

    selected_set = set(selected_tlds)
    growth_path = _update_growth_trends(
        date_utc,
        [row for row in processed_rows if row.get("tld") in selected_set],
        set(discovery_meta["newly_approved"]),
        run_id,
        settings,
    )

    signal_meta = compute_signals_for_date(date_utc, run_id=run_id, settings=settings)
    digest_meta = write_daily_digest(date_utc, run_id=run_id, settings=settings)

    processed_ok = sum(1 for row in processed_rows if row.get("status") == "ok")
    summary = {
        "mode": "daily",
        "approved_count": len(discovery_meta.get("tlds", [])),
        "selected_count": len(selected_tlds),
        "processed_ok": processed_ok,
        "failed": sum(1 for row in processed_rows if row.get("status") == "failed"),
        "daily_counts": str(daily_path),
    }

    return _build_outputs(
        date_utc=date_utc,
        run_id=run_id,
        selected_tlds=selected_tlds,
        processed_rows=processed_rows,
        daily_path=daily_path,
        growth_path=growth_path,
        signal_meta=signal_meta,
        digest_meta=digest_meta,
        summary=summary,
    )


def run_hybrid(
    date_utc: str | None = None,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    skip_discovery: bool = False,
    allow_incomplete_baseline: bool = False,
    settings: Settings | None = None,
) -> RunResult:
    settings = settings or get_settings()
    date_utc = date_utc or utc_today_str()
    run_id = str(uuid.uuid4())
    log_path = settings.logs_dir / f"run_hybrid_{date_utc}.log"
    logger = setup_logger("rootfetch.pipeline.hybrid", log_path=log_path, verbose=verbose)

    ensure_dir(settings.daily_counts_dir)
    ensure_dir(settings.approved_dir)
    ensure_dir(settings.signals_dir)
    ensure_dir(settings.logs_dir)
    ensure_dir(settings.snapshots_dir)
    ensure_dir(settings.state_dir)

    if not dry_run:
        _migrate_legacy_cadence_once(settings)

    baseline_status: dict[str, Any] | None = None
    if not dry_run:
        completion = baseline_completion_status(date_utc=date_utc, settings=settings)
        baseline_status = completion
        if not completion["baseline_complete"]:
            if not allow_incomplete_baseline:
                raise RuntimeError(
                    "Baseline is incomplete. Run `rootfetch run-baseline --resume` until "
                    "approved_tlds_count == counted_ever_count and missing_ever_count == 0."
                )
            logger.warning(
                "baseline incomplete, continuing due to allow_incomplete_baseline=true "
                "(approved=%s counted_ever=%s missing_ever=%s)",
                completion.get("approved_tlds_count"),
                completion.get("counted_ever_count"),
                completion.get("missing_ever_count"),
            )

    approved_links: list[dict[str, str]] = []
    discovery_meta: dict[str, Any] = {
        "newly_approved": [],
        "tlds": [],
        "sanitized_path": settings.approved_dir / f"{date_utc}.json",
        "latest_path": settings.approved_dir / "latest.json",
    }

    if dry_run:
        approved_tlds = _load_approved_tlds_latest(settings)
    else:
        token = get_access_token(settings=settings, dry_run=False)
        if skip_discovery:
            approved_links = _load_links_from_internal_snapshot(settings)
            if not approved_links:
                raise RuntimeError(
                    "Missing .ai/approved_snapshot.json links; run discover first or remove --skip-discovery."
                )
            discovery_meta = write_discovery_artifacts(approved_links, date_utc=date_utc, settings=settings)
            approved_tlds = sorted({item["tld"] for item in approved_links})
        else:
            approved_links = fetch_approved_links(token, settings=settings, dry_run=False)
            discovery_meta = write_discovery_artifacts(approved_links, date_utc=date_utc, settings=settings)
            approved_tlds = discovery_meta.get("tlds", [])

    selection = select_hybrid_tlds(approved_tlds=approved_tlds, date_utc=date_utc, settings=settings)
    target_tlds = selection["target_today"]
    cadence_map: dict[str, str] = selection["cadence_map"]

    summary = {
        "mode": "hybrid",
        "approved_count": selection["approved_count"],
        "core_today_count": len(selection["core_today"]),
        "rolling_today_count": len(selection["rolling_today"]),
        "total_target_count": len(target_tlds),
        "rolling_first_10": selection["rolling_first_10"],
        "baseline_gate": "allow_incomplete" if allow_incomplete_baseline else "strict",
    }
    if baseline_status:
        summary["baseline_status"] = {
            "baseline_complete": bool(baseline_status.get("baseline_complete")),
            "approved_tlds_count": int(baseline_status.get("approved_tlds_count") or 0),
            "counted_ever_count": int(baseline_status.get("counted_ever_count") or 0),
            "missing_ever_count": int(baseline_status.get("missing_ever_count") or 0),
        }

    if dry_run:
        return RunResult(
            date_utc=date_utc,
            run_id=run_id,
            selected_tlds=target_tlds,
            processed_tlds=[],
            failed_tlds=[],
            outputs={},
            summary=summary,
        )

    token = get_access_token(settings=settings, dry_run=False)
    target_set = set(target_tlds)
    target_links = [item for item in approved_links if item["tld"] in target_set]
    target_links.sort(key=lambda item: item["tld"])

    daily_path, _, processed_rows = _prepare_daily_rows_for_targets(
        date_utc=date_utc,
        target_links=target_links,
        cadence_map=cadence_map,
        token=token,
        settings=settings,
        logger=logger,
    )

    selected_set = set(target_tlds)
    growth_path = _update_growth_trends(
        date_utc,
        [row for row in processed_rows if row.get("tld") in selected_set],
        set(discovery_meta.get("newly_approved", [])),
        run_id,
        settings,
    )

    signal_meta = compute_signals_for_date(date_utc, run_id=run_id, settings=settings)
    digest_meta = write_daily_digest(date_utc, run_id=run_id, settings=settings)

    processed_selected_rows = [row for row in processed_rows if row.get("tld") in selected_set]
    processed_ok = [row for row in processed_selected_rows if row.get("status") == "ok"]
    failed_rows = [row for row in processed_selected_rows if row.get("status") == "failed"]
    total_counted_sum = int(sum(_safe_float(row.get("count")) or 0 for row in processed_ok))
    missing_today = max(0, selection["approved_count"] - len(processed_ok))

    summary.update(
        {
            "processed_ok": len(processed_ok),
            "failed": len(failed_rows),
            "missing_today": missing_today,
            "total_counted_sum": total_counted_sum,
            "daily_counts": str(daily_path),
            "core_today": selection["core_today"],
            "rolling_today": selection["rolling_today"],
        }
    )

    return _build_outputs(
        date_utc=date_utc,
        run_id=run_id,
        selected_tlds=target_tlds,
        processed_rows=processed_rows,
        daily_path=daily_path,
        growth_path=growth_path,
        signal_meta=signal_meta,
        digest_meta=digest_meta,
        summary=summary,
    )


def run_baseline(
    date_utc: str | None = None,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    resume: bool = False,
    skip_discovery: bool = False,
    settings: Settings | None = None,
) -> RunResult:
    settings = settings or get_settings()
    baseline_date_utc = _resolve_baseline_date(date_utc=date_utc, resume=resume, settings=settings)
    run_id = str(uuid.uuid4())
    log_path = settings.logs_dir / f"run_baseline_{baseline_date_utc}.log"
    logger = setup_logger("rootfetch.pipeline.baseline", log_path=log_path, verbose=verbose)

    ensure_dir(settings.daily_counts_dir)
    ensure_dir(settings.approved_dir)
    ensure_dir(settings.signals_dir)
    ensure_dir(settings.logs_dir)
    ensure_dir(settings.snapshots_dir)
    ensure_dir(settings.state_dir)
    ensure_dir(settings.baseline_progress_path.parent)

    if not dry_run:
        _migrate_legacy_cadence_once(settings)

    approved_links: list[dict[str, str]] = []
    approved_tlds: list[str] = []
    source = ""
    discovery_meta: dict[str, Any] = {
        "newly_approved": [],
        "tlds": [],
    }

    if dry_run:
        approved_tlds = _load_approved_tlds_latest(settings)
        source = "approved_latest"
        if not approved_tlds:
            approved_links = _load_links_from_internal_snapshot(settings)
            approved_tlds = sorted({item["tld"] for item in approved_links})
            source = "internal_snapshot"
    else:
        token = get_access_token(settings=settings, dry_run=False)
        if skip_discovery:
            approved_links = _load_links_from_internal_snapshot(settings)
            if not approved_links:
                raise RuntimeError(
                    "Missing .ai/approved_snapshot.json links; run discover first or remove --skip-discovery."
                )
            discovery_meta = write_discovery_artifacts(approved_links, date_utc=baseline_date_utc, settings=settings)
            approved_tlds = sorted({item["tld"] for item in approved_links})
            source = "internal_snapshot"
        else:
            approved_links = fetch_approved_links(token, settings=settings, dry_run=False)
            discovery_meta = write_discovery_artifacts(approved_links, date_utc=baseline_date_utc, settings=settings)
            approved_tlds = discovery_meta.get("tlds", [])
            source = "czds_discovery"

    approved_set = set(approved_tlds)
    coverage_meta = compute_coverage_latest(baseline_date_utc, settings=settings)
    coverage_payload = coverage_meta["coverage_payload"]
    missing_ever = _normalize_tld_set(coverage_payload.get("missing_ever_tlds", []))
    counted_ever = _normalize_tld_set(coverage_payload.get("counted_ever_tlds", []))

    # Baseline resume should target only TLDs missing from historical coverage,
    # not all TLDs missing in today's date-specific file.
    if missing_ever:
        baseline_target_tlds = sorted(approved_set & missing_ever)
    else:
        baseline_target_tlds = sorted(approved_set - counted_ever)
    already_ok = approved_set - set(baseline_target_tlds)

    summary = {
        "mode": "baseline",
        "baseline_date_utc": baseline_date_utc,
        "approved_count": len(approved_tlds),
        "already_ok_count": len(already_ok),
        "baseline_target_count": len(baseline_target_tlds),
        "source": source,
        "resume": bool(resume),
    }

    if dry_run:
        return RunResult(
            date_utc=baseline_date_utc,
            run_id=run_id,
            selected_tlds=baseline_target_tlds,
            processed_tlds=[],
            failed_tlds=[],
            outputs={},
            summary=summary,
        )

    _save_baseline_progress(settings, baseline_date_utc=baseline_date_utc, approved_count=len(approved_tlds))

    link_by_tld = {item["tld"]: item["url"] for item in approved_links}
    missing_link_tlds = [tld for tld in baseline_target_tlds if tld not in link_by_tld]
    if missing_link_tlds:
        logger.warning("baseline missing download links for %s tlds", len(missing_link_tlds))

    target_links = [
        {"tld": tld, "url": link_by_tld[tld]}
        for tld in baseline_target_tlds
        if tld in link_by_tld
    ]

    token = get_access_token(settings=settings, dry_run=False)
    daily_path, rows_for_write, processed_rows = _prepare_baseline_rows(
        date_utc=baseline_date_utc,
        approved_tlds=approved_tlds,
        target_links=target_links,
        progress_tlds=baseline_target_tlds,
        token=token,
        settings=settings,
        logger=logger,
    )

    rows_for_growth = [row for row in rows_for_write if row.get("tld") in approved_set]
    growth_path = _update_growth_trends(
        baseline_date_utc,
        rows_for_growth,
        set(discovery_meta.get("newly_approved", [])),
        run_id,
        settings,
    )

    signal_meta = compute_signals_for_date(baseline_date_utc, run_id=run_id, settings=settings)
    digest_meta = write_daily_digest(baseline_date_utc, run_id=run_id, settings=settings)
    rag_meta = build_static_rag(settings=settings)

    coverage_payload = _read_coverage_payload(Path(signal_meta["coverage_path"]))
    approved_count = int(coverage_payload.get("approved_tlds_count", len(approved_tlds)))
    counted_ever_count = int(coverage_payload.get("counted_ever_count", 0))
    missing_ever_count = int(coverage_payload.get("missing_ever_count", 0))

    baseline_complete = bool(
        approved_count > 0
        and approved_count == counted_ever_count
        and missing_ever_count == 0
    )

    if baseline_complete:
        _write_baseline_complete_marker(
            baseline_date_utc=baseline_date_utc,
            approved_count=approved_count,
            settings=settings,
        )
        _clear_baseline_progress(settings)

    processed_ok = _count_ok_rows_for_tlds(rows_for_write, approved_set)
    remaining = max(0, len(approved_set) - processed_ok)

    summary.update(
        {
            "attempted_this_run": len(processed_rows),
            "failed_this_run": sum(1 for row in processed_rows if row.get("status") == "failed"),
            "processed_ok": processed_ok,
            "remaining": remaining,
            "missing_link_count": len(missing_link_tlds),
            "baseline_complete": baseline_complete,
            "counted_ever_count": counted_ever_count,
            "missing_ever_count": missing_ever_count,
            "daily_counts": str(daily_path),
            "rag_chunks_indexed": int(rag_meta.get("chunks_indexed", 0)),
        }
    )

    signal_meta_with_rag = dict(signal_meta)
    signal_meta_with_rag["rag_chunks_path"] = settings.static_rag_chunks_path
    signal_meta_with_rag["rag_meta_path"] = settings.static_rag_meta_path

    return _build_outputs(
        date_utc=baseline_date_utc,
        run_id=run_id,
        selected_tlds=baseline_target_tlds,
        processed_rows=processed_rows,
        daily_path=daily_path,
        growth_path=growth_path,
        signal_meta=signal_meta_with_rag,
        digest_meta=digest_meta,
        summary=summary,
    )


def run_discovery_only(*, date_utc: str | None = None, dry_run: bool = False, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    date_utc = date_utc or utc_today_str()
    token = get_access_token(settings=settings, dry_run=dry_run)
    links = fetch_approved_links(token, settings=settings, dry_run=dry_run)
    return write_discovery_artifacts(links, date_utc=date_utc, settings=settings)
