from __future__ import annotations

import contextlib
import hashlib
import json
import os
import random
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json

try:
    import fcntl
except Exception:  # pragma: no cover
    fcntl = None


SUPPORTED_CHANNELS = ("slack", "discord")
MODEL_VERSION_DEFAULT = "rootfetch_model_v1"
STATE_SCHEMA_VERSION = 2


@dataclass(frozen=True)
class AlertItem:
    code: str
    severity: str
    message: str
    rule_id: str
    entity_id: str
    trigger_signature: str
    model_version: str = MODEL_VERSION_DEFAULT


def _safe_read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def _safe_read_json(path: Path, *, quarantine_on_error: bool = False) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = read_json(path)
    except Exception:
        if quarantine_on_error:
            stamp = _now_utc().strftime("%Y%m%dT%H%M%SZ")
            quarantine = path.with_name(f"{path.name}.corrupt-{stamp}")
            with contextlib.suppress(Exception):
                path.replace(quarantine)
        return {}
    return payload if isinstance(payload, dict) else {}


def _threshold(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _alerts_dir(settings: Settings) -> Path:
    path = settings.ai_dir / "alerts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _state_path(settings: Settings) -> Path:
    return _alerts_dir(settings) / "state.json"


def _lock_path(settings: Settings) -> Path:
    return _alerts_dir(settings) / "state.lock"


def _delivery_log_path(settings: Settings) -> Path:
    return _alerts_dir(settings) / "delivery_log.jsonl"


def _state_template() -> dict[str, Any]:
    return {
        "version": STATE_SCHEMA_VERSION,
        "active": [],
        "delivered_index": {},
        "dead_letters": [],
        "updated_at_utc": _iso(_now_utc()),
    }


def _normalize_state(payload: dict[str, Any]) -> dict[str, Any]:
    state = dict(payload)
    state["version"] = STATE_SCHEMA_VERSION
    state["active"] = list(state.get("active") or [])
    state["delivered_index"] = dict(state.get("delivered_index") or {})
    state["dead_letters"] = list(state.get("dead_letters") or [])
    state["updated_at_utc"] = str(state.get("updated_at_utc") or _iso(_now_utc()))

    normalized_active: list[dict[str, Any]] = []
    for item in state["active"]:
        if not isinstance(item, dict):
            continue
        dedup_key = str(item.get("dedup_key") or item.get("fingerprint") or "").strip()
        if not dedup_key:
            continue
        channels = dict(item.get("channels") or {})
        normalized_channels: dict[str, dict[str, Any]] = {}
        for channel, channel_state in channels.items():
            normalized_channels[str(channel)] = {
                "status": str((channel_state or {}).get("status") or "pending"),
                "attempts": int((channel_state or {}).get("attempts") or 0),
                "last_error": str((channel_state or {}).get("last_error") or ""),
                "last_attempt_at_utc": str((channel_state or {}).get("last_attempt_at_utc") or ""),
                "sent_at_utc": str((channel_state or {}).get("sent_at_utc") or ""),
            }

        normalized_active.append(
            {
                "id": str(item.get("id") or ""),
                "date_utc": str(item.get("date_utc") or ""),
                "code": str(item.get("code") or ""),
                "severity": str(item.get("severity") or ""),
                "message": str(item.get("message") or ""),
                "rule_id": str(item.get("rule_id") or ""),
                "entity_id": str(item.get("entity_id") or ""),
                "trigger_signature": str(item.get("trigger_signature") or ""),
                "model_version": str(item.get("model_version") or MODEL_VERSION_DEFAULT),
                "dedup_key": dedup_key,
                "fingerprint": dedup_key,
                "created_at_utc": str(item.get("created_at_utc") or _iso(_now_utc())),
                "next_attempt_at_utc": str(item.get("next_attempt_at_utc") or _iso(_now_utc())),
                "max_attempts": int(item.get("max_attempts") or 1),
                "channels": normalized_channels,
            }
        )

    state["active"] = normalized_active
    state["delivered_index"] = {
        str(key): str(value)
        for key, value in state["delivered_index"].items()
        if str(key).strip()
    }
    return state


def _load_state(settings: Settings) -> dict[str, Any]:
    path = _state_path(settings)
    if not path.exists():
        return _state_template()
    payload = _safe_read_json(path, quarantine_on_error=True)
    if not payload:
        return _state_template()
    return _normalize_state(payload)


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except Exception:
        return
    try:
        os.fsync(fd)
    except Exception:
        return
    finally:
        os.close(fd)


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.tmp-", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        _fsync_dir(path.parent)
    finally:
        if temp_path.exists():
            with contextlib.suppress(Exception):
                temp_path.unlink()


def _save_state(settings: Settings, state: dict[str, Any]) -> None:
    state["updated_at_utc"] = _iso(_now_utc())
    payload = json.dumps(state, indent=2, sort_keys=False) + "\n"
    _atomic_write_text(_state_path(settings), payload)


def _append_delivery_log(settings: Settings, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path = _delivery_log_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


@contextlib.contextmanager
def _state_lock(settings: Settings, *, timeout_seconds: int):
    if fcntl is None:  # pragma: no cover
        yield
        return

    lock_file = _lock_path(settings)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    lock_file.touch(exist_ok=True)

    with lock_file.open("a+", encoding="utf-8") as lock_handle:
        deadline = time.monotonic() + max(0, timeout_seconds)
        while True:
            try:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if timeout_seconds == 0 or time.monotonic() >= deadline:
                    raise TimeoutError(f"alerts state lock unavailable after {timeout_seconds}s")
                time.sleep(0.1)

        try:
            yield
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def _collect_alerts(date_utc: str, settings: Settings) -> list[AlertItem]:
    alerts: list[AlertItem] = []

    approvals_diff = _safe_read_json(settings.signals_dir / f"{date_utc}_approvals_diff.json")
    added_count = int(approvals_diff.get("added_count") or 0)
    if added_count > 0:
        added_preview = list(approvals_diff.get("added") or [])[:15]
        alerts.append(
            AlertItem(
                code="new_approvals",
                severity="info",
                message=f"New CZDS approvals: +{added_count}. Examples: {', '.join(added_preview) if added_preview else 'n/a'}",
                rule_id="approvals_diff_added",
                entity_id="global:approvals",
                trigger_signature=f"added_count={added_count}",
            )
        )

    movers_threshold_abs = _threshold("ROOTFETCH_ALERT_MOVER_ABS_THRESHOLD", 100_000)
    movers_threshold_pct = _threshold("ROOTFETCH_ALERT_MOVER_PCT_THRESHOLD", 0.25)
    movers_df = _safe_read_csv(settings.signals_dir / f"{date_utc}_core_top_movers.csv")
    if not movers_df.empty:
        movers_df["delta_abs_num"] = pd.to_numeric(movers_df.get("delta_abs"), errors="coerce")
        movers_df["delta_pct_num"] = pd.to_numeric(movers_df.get("delta_pct"), errors="coerce")
        notable = movers_df[
            (movers_df["delta_abs_num"].abs() >= movers_threshold_abs)
            | (movers_df["delta_pct_num"].abs() >= movers_threshold_pct)
        ].head(8)
        for _, row in notable.iterrows():
            tld = str(row.get("tld") or "").strip().lower() or "unknown"
            delta_abs = int(row.get("delta_abs_num") or 0)
            delta_pct = float(row.get("delta_pct_num") or 0.0)
            alerts.append(
                AlertItem(
                    code="core_mover",
                    severity="warning",
                    message=(
                        f"Core mover {tld}: delta_abs={delta_abs:,} "
                        f"delta_pct={(delta_pct * 100):.2f}%"
                    ),
                    rule_id="core_mover_threshold",
                    entity_id=f"tld:{tld}",
                    trigger_signature=(
                        f"delta_abs={delta_abs};delta_pct={delta_pct:.8f};"
                        f"thr_abs={movers_threshold_abs};thr_pct={movers_threshold_pct}"
                    ),
                )
            )

    anomaly_threshold = _threshold("ROOTFETCH_ALERT_ANOMALY_Z_THRESHOLD", 3.0)
    anomalies_df = _safe_read_csv(settings.signals_dir / f"{date_utc}_anomalies.csv")
    if not anomalies_df.empty:
        anomalies_df["z_num"] = pd.to_numeric(anomalies_df.get("z"), errors="coerce")
        anomalies_df["robust_z_num"] = pd.to_numeric(anomalies_df.get("robust_z"), errors="coerce")
        flagged = anomalies_df[
            anomalies_df["z_num"].abs().ge(anomaly_threshold)
            | anomalies_df["robust_z_num"].abs().ge(anomaly_threshold)
        ].head(10)
        for _, row in flagged.iterrows():
            tld = str(row.get("tld") or "").strip().lower() or "unknown"
            z_num = float(row.get("z_num") or 0.0)
            robust_z_num = float(row.get("robust_z_num") or 0.0)
            reason = str(row.get("reason") or "unknown")
            alerts.append(
                AlertItem(
                    code="anomaly",
                    severity="warning",
                    message=(
                        f"Anomaly {tld}: reason={reason}, "
                        f"z={z_num:.2f}, robust_z={robust_z_num:.2f}"
                    ),
                    rule_id="anomaly_zscore_threshold",
                    entity_id=f"tld:{tld}",
                    trigger_signature=(
                        f"z={z_num:.8f};robust_z={robust_z_num:.8f};"
                        f"threshold={anomaly_threshold};reason={reason}"
                    ),
                )
            )

    failures_threshold = int(_threshold("ROOTFETCH_ALERT_FAILURE_THRESHOLD", 1))
    daily_df = _safe_read_csv(settings.daily_counts_dir / f"{date_utc}.csv")
    failure_count = 0
    if not daily_df.empty and "status" in daily_df.columns:
        failure_count = int((daily_df["status"].astype(str).str.lower() == "failed").sum())
    if failure_count >= failures_threshold:
        alerts.append(
            AlertItem(
                code="pipeline_failures",
                severity="critical",
                message=f"Pipeline failures for {date_utc}: {failure_count}",
                rule_id="pipeline_failures_threshold",
                entity_id="global:pipeline",
                trigger_signature=f"failure_count={failure_count};threshold={failures_threshold}",
            )
        )

    return alerts


def _dedup_key(date_utc: str, item: AlertItem) -> str:
    raw = "|".join(
        [
            item.model_version,
            item.rule_id,
            item.entity_id,
            date_utc,
            item.code,
            item.severity,
            item.trigger_signature,
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _item_dedup_key(item: dict[str, Any]) -> str:
    return str(item.get("dedup_key") or item.get("fingerprint") or "").strip()


def _enabled_targets() -> dict[str, str]:
    targets = {
        "slack": os.getenv("ROOTFETCH_SLACK_WEBHOOK_URL", "").strip(),
        "discord": os.getenv("ROOTFETCH_DISCORD_WEBHOOK_URL", "").strip(),
    }
    return {channel: url for channel, url in targets.items() if url}


def _request_headers(*, dedup_key: str, payload_hash: str) -> dict[str, str]:
    return {
        "Idempotency-Key": dedup_key,
        "X-RootFetch-Dedup-Key": dedup_key,
        "X-RootFetch-Payload-Hash": payload_hash,
    }


def _send_slack(webhook_url: str, text: str, *, dedup_key: str, payload_hash: str) -> None:
    response = requests.post(
        webhook_url,
        json={"text": text},
        headers=_request_headers(dedup_key=dedup_key, payload_hash=payload_hash),
        timeout=20,
    )
    response.raise_for_status()


def _send_discord(webhook_url: str, text: str, *, dedup_key: str, payload_hash: str) -> None:
    response = requests.post(
        webhook_url,
        json={"content": text},
        headers=_request_headers(dedup_key=dedup_key, payload_hash=payload_hash),
        timeout=20,
    )
    response.raise_for_status()


def _send_channel(channel: str, webhook_url: str, text: str, *, dedup_key: str, payload_hash: str) -> None:
    if channel == "slack":
        _send_slack(webhook_url, text, dedup_key=dedup_key, payload_hash=payload_hash)
        return
    if channel == "discord":
        _send_discord(webhook_url, text, dedup_key=dedup_key, payload_hash=payload_hash)
        return
    raise RuntimeError(f"unsupported channel: {channel}")


def _delivery_text(date_utc: str, item: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"RootFetch alerts for {date_utc}",
            f"- [{item.get('severity')}] {item.get('message')}",
            f"- Rule: {item.get('rule_id')}",
            f"- Entity: {item.get('entity_id')}",
        ]
    )


def _payload_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _backoff_seconds(
    attempts: int,
    *,
    base_seconds: int,
    max_seconds: int,
    jitter_pct: float,
) -> int:
    exponent = max(0, attempts - 1)
    delay = float(base_seconds * (2 ** exponent))
    delay = min(float(max_seconds), max(float(base_seconds), delay))
    if jitter_pct > 0:
        jitter_range = delay * jitter_pct
        delay += random.uniform(-jitter_range, jitter_range)
    delay = min(float(max_seconds), max(1.0, delay))
    return int(round(delay))


def _trim_delivered_index(
    delivered_index: dict[str, str],
    *,
    now: datetime,
    horizon_days: int = 30,
) -> dict[str, str]:
    out: dict[str, str] = {}
    cutoff = now - timedelta(days=horizon_days)
    for dedup_key, sent_at in delivered_index.items():
        parsed = _parse_utc(sent_at)
        if parsed is None:
            continue
        if parsed >= cutoff:
            out[str(dedup_key)] = _iso(parsed)
    return out


def _enqueue_alerts(
    *,
    state: dict[str, Any],
    alerts: list[AlertItem],
    date_utc: str,
    now: datetime,
    enabled_channels: list[str],
    dedup_hours: int,
    max_attempts: int,
) -> dict[str, int]:
    active = list(state.get("active") or [])
    active_keys = {_item_dedup_key(item) for item in active}
    delivered_index = dict(state.get("delivered_index") or {})

    enqueued = 0
    skipped_duplicate = 0
    skipped_no_destinations = 0

    for alert in alerts:
        dedup_key = _dedup_key(date_utc, alert)
        if dedup_key in active_keys:
            skipped_duplicate += 1
            continue

        delivered_at = _parse_utc(delivered_index.get(dedup_key))
        if delivered_at is not None and (now - delivered_at) <= timedelta(hours=dedup_hours):
            skipped_duplicate += 1
            continue

        if not enabled_channels:
            skipped_no_destinations += 1
            continue

        channels = {
            channel: {
                "status": "pending",
                "attempts": 0,
                "last_error": "",
                "last_attempt_at_utc": "",
                "sent_at_utc": "",
            }
            for channel in enabled_channels
        }

        active.append(
            {
                "id": f"{date_utc}:{dedup_key[:12]}",
                "date_utc": date_utc,
                "code": alert.code,
                "severity": alert.severity,
                "message": alert.message,
                "rule_id": alert.rule_id,
                "entity_id": alert.entity_id,
                "trigger_signature": alert.trigger_signature,
                "model_version": alert.model_version,
                "dedup_key": dedup_key,
                "fingerprint": dedup_key,
                "created_at_utc": _iso(now),
                "next_attempt_at_utc": _iso(now),
                "max_attempts": int(max_attempts),
                "channels": channels,
            }
        )
        active_keys.add(dedup_key)
        enqueued += 1

    state["active"] = active
    return {
        "enqueued": enqueued,
        "skipped_duplicate": skipped_duplicate,
        "skipped_no_destinations": skipped_no_destinations,
    }


def _process_queue(
    *,
    state: dict[str, Any],
    now: datetime,
    targets: dict[str, str],
    retry_base_seconds: int,
    retry_max_seconds: int,
    retry_jitter_pct: float,
) -> dict[str, Any]:
    active = list(state.get("active") or [])
    delivered_index = dict(state.get("delivered_index") or {})
    dead_letters = list(state.get("dead_letters") or [])
    attempts_log: list[dict[str, Any]] = []

    sent_attempts = 0
    failed_attempts = 0
    retried_items = 0
    delivered_items = 0
    dead_letter_items = 0

    next_active: list[dict[str, Any]] = []

    for item in active:
        next_attempt_at = _parse_utc(str(item.get("next_attempt_at_utc") or ""))
        if next_attempt_at is not None and next_attempt_at > now:
            next_active.append(item)
            continue

        channels = dict(item.get("channels") or {})
        pending_channels = [
            channel
            for channel, channel_state in channels.items()
            if str((channel_state or {}).get("status") or "pending") == "pending"
        ]
        if not pending_channels:
            next_active.append(item)
            continue

        dedup_key = _item_dedup_key(item)
        delivery_text = _delivery_text(str(item.get("date_utc") or ""), item)
        payload_hash = _payload_hash(delivery_text)
        item_had_failure = False

        for channel in pending_channels:
            channel_state = dict(channels.get(channel) or {})
            attempts = int(channel_state.get("attempts") or 0)
            max_attempts = int(item.get("max_attempts") or 1)
            if attempts >= max_attempts:
                channel_state["status"] = "dead_letter"
                channels[channel] = channel_state
                continue

            url = targets.get(channel)
            if not url:
                continue

            timestamp = _iso(now)
            attempt_num = attempts + 1
            try:
                _send_channel(
                    channel,
                    url,
                    delivery_text,
                    dedup_key=dedup_key,
                    payload_hash=payload_hash,
                )
            except Exception as exc:
                attempts = attempt_num
                channel_state["attempts"] = attempts
                channel_state["last_attempt_at_utc"] = timestamp
                channel_state["last_error"] = str(exc)
                channel_state["status"] = "pending" if attempts < max_attempts else "dead_letter"
                channels[channel] = channel_state
                failed_attempts += 1
                item_had_failure = True
                attempts_log.append(
                    {
                        "queued_at_utc": str(item.get("created_at_utc") or ""),
                        "attempt_at_utc": timestamp,
                        "attempt_num": attempt_num,
                        "max_attempts": max_attempts,
                        "destination": channel,
                        "alert_id": str(item.get("id") or ""),
                        "date_utc": str(item.get("date_utc") or ""),
                        "code": str(item.get("code") or ""),
                        "severity": str(item.get("severity") or ""),
                        "rule_id": str(item.get("rule_id") or ""),
                        "entity_id": str(item.get("entity_id") or ""),
                        "dedup_key": dedup_key,
                        "payload_hash": payload_hash,
                        "result": "retry" if channel_state["status"] == "pending" else "dead_letter",
                        "error_class": exc.__class__.__name__,
                        "error_message": str(exc),
                    }
                )
            else:
                attempts = attempt_num
                channel_state["attempts"] = attempts
                channel_state["last_attempt_at_utc"] = timestamp
                channel_state["last_error"] = ""
                channel_state["status"] = "sent"
                channel_state["sent_at_utc"] = timestamp
                channels[channel] = channel_state
                sent_attempts += 1
                attempts_log.append(
                    {
                        "queued_at_utc": str(item.get("created_at_utc") or ""),
                        "attempt_at_utc": timestamp,
                        "attempt_num": attempt_num,
                        "max_attempts": max_attempts,
                        "destination": channel,
                        "alert_id": str(item.get("id") or ""),
                        "date_utc": str(item.get("date_utc") or ""),
                        "code": str(item.get("code") or ""),
                        "severity": str(item.get("severity") or ""),
                        "rule_id": str(item.get("rule_id") or ""),
                        "entity_id": str(item.get("entity_id") or ""),
                        "dedup_key": dedup_key,
                        "payload_hash": payload_hash,
                        "result": "success",
                        "error_class": "",
                        "error_message": "",
                    }
                )

        item["channels"] = channels
        pending_after = [
            channel
            for channel, channel_state in channels.items()
            if str((channel_state or {}).get("status") or "pending") == "pending"
        ]
        sent_after = [
            channel
            for channel, channel_state in channels.items()
            if str((channel_state or {}).get("status") or "") == "sent"
        ]
        dead_after = [
            channel
            for channel, channel_state in channels.items()
            if str((channel_state or {}).get("status") or "") == "dead_letter"
        ]

        if pending_after:
            max_attempts_so_far = max(int((channels[channel] or {}).get("attempts") or 0) for channel in pending_after)
            delay_seconds = _backoff_seconds(
                max_attempts_so_far,
                base_seconds=retry_base_seconds,
                max_seconds=retry_max_seconds,
                jitter_pct=retry_jitter_pct,
            )
            item["next_attempt_at_utc"] = _iso(now + timedelta(seconds=delay_seconds))
            next_active.append(item)
            if item_had_failure:
                retried_items += 1
            continue

        if sent_after:
            delivered_items += 1
            delivered_index[dedup_key] = _iso(now)

        if dead_after:
            dead_letter_items += 1
            dead_channels = {channel: channels[channel] for channel in dead_after}
            last_error = ""
            for channel in dead_after:
                last_error = str((channels[channel] or {}).get("last_error") or "")
                if last_error:
                    break
            dead_letters.append(
                {
                    "id": str(item.get("id") or ""),
                    "date_utc": str(item.get("date_utc") or ""),
                    "dedup_key": dedup_key,
                    "code": str(item.get("code") or ""),
                    "severity": str(item.get("severity") or ""),
                    "rule_id": str(item.get("rule_id") or ""),
                    "entity_id": str(item.get("entity_id") or ""),
                    "message": str(item.get("message") or ""),
                    "payload": {
                        "date_utc": str(item.get("date_utc") or ""),
                        "code": str(item.get("code") or ""),
                        "severity": str(item.get("severity") or ""),
                        "rule_id": str(item.get("rule_id") or ""),
                        "entity_id": str(item.get("entity_id") or ""),
                        "trigger_signature": str(item.get("trigger_signature") or ""),
                        "message": str(item.get("message") or ""),
                    },
                    "channels": dead_channels,
                    "attempts_total": sum(int((dead_channels[ch] or {}).get("attempts") or 0) for ch in dead_channels),
                    "last_error": last_error,
                    "finalized_at_utc": _iso(now),
                    "requeue_hint": "Remove this dead-letter item and rerun rootfetch alerts run --date <date>",
                }
            )

    state["active"] = next_active
    state["dead_letters"] = dead_letters[-500:]
    state["delivered_index"] = _trim_delivered_index(delivered_index, now=now, horizon_days=30)

    return {
        "sent_attempts": sent_attempts,
        "failed_attempts": failed_attempts,
        "retried_items": retried_items,
        "delivered_items": delivered_items,
        "dead_letter_items": dead_letter_items,
        "attempts_log": attempts_log,
    }


def run_alerts(
    *,
    date_utc: str,
    dry_run: bool = False,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    alerts = _collect_alerts(date_utc, settings)

    targets = _enabled_targets()
    enabled_channels = sorted(targets.keys())
    now = _now_utc()
    retry_max = max(1, _int_env("ROOTFETCH_ALERT_RETRY_MAX", 5))
    retry_base_seconds = max(5, _int_env("ROOTFETCH_ALERT_RETRY_BASE_SECONDS", 30))
    retry_max_seconds = max(retry_base_seconds, _int_env("ROOTFETCH_ALERT_RETRY_MAX_SECONDS", 3600))
    retry_jitter_pct = max(0.0, min(1.0, _threshold("ROOTFETCH_ALERT_RETRY_JITTER_PCT", 0.2)))
    dedup_hours = max(0, _int_env("ROOTFETCH_ALERT_DEDUP_HOURS", 24))
    lock_timeout_seconds = max(0, _int_env("ROOTFETCH_ALERT_LOCK_TIMEOUT_SECONDS", 30))

    if dry_run:
        state = _load_state(settings)
        active_before = len(state.get("active") or [])
        queue_stats = _enqueue_alerts(
            state=state,
            alerts=alerts,
            date_utc=date_utc,
            now=now,
            enabled_channels=enabled_channels,
            dedup_hours=dedup_hours,
            max_attempts=retry_max,
        )
        return {
            "date_utc": date_utc,
            "alerts_count": len(alerts),
            "alerts": [asdict(item) for item in alerts],
            "dry_run": True,
            "would_send": {
                "slack": "slack" in targets,
                "discord": "discord" in targets,
            },
            "queue": {
                "active_before": active_before,
                "enqueued": queue_stats["enqueued"],
                "skipped_duplicate": queue_stats["skipped_duplicate"],
                "skipped_no_destinations": queue_stats["skipped_no_destinations"],
            },
            "policy": {
                "retry_max": retry_max,
                "retry_base_seconds": retry_base_seconds,
                "retry_max_seconds": retry_max_seconds,
                "retry_jitter_pct": retry_jitter_pct,
                "dedup_hours": dedup_hours,
                "lock_timeout_seconds": lock_timeout_seconds,
            },
        }

    try:
        with _state_lock(settings, timeout_seconds=lock_timeout_seconds):
            state = _load_state(settings)
            active_before = len(state.get("active") or [])
            queue_stats = _enqueue_alerts(
                state=state,
                alerts=alerts,
                date_utc=date_utc,
                now=now,
                enabled_channels=enabled_channels,
                dedup_hours=dedup_hours,
                max_attempts=retry_max,
            )

            process_stats = _process_queue(
                state=state,
                now=now,
                targets=targets,
                retry_base_seconds=retry_base_seconds,
                retry_max_seconds=retry_max_seconds,
                retry_jitter_pct=retry_jitter_pct,
            )
            _save_state(settings, state)
            _append_delivery_log(settings, process_stats["attempts_log"])
    except TimeoutError as exc:
        return {
            "date_utc": date_utc,
            "alerts_count": len(alerts),
            "alerts": [asdict(item) for item in alerts],
            "dry_run": False,
            "skipped_due_to_lock": True,
            "error": str(exc),
            "channels_enabled": enabled_channels,
            "queue": {
                "active_count": 0,
                "active_before": 0,
                "enqueued": 0,
                "skipped_duplicate": 0,
                "skipped_no_destinations": 0,
                "dead_letters": 0,
            },
            "delivery": {
                "sent_attempts": 0,
                "failed_attempts": 0,
                "retried_items": 0,
                "delivered_items": 0,
                "dead_letter_items": 0,
            },
            "policy": {
                "retry_max": retry_max,
                "retry_base_seconds": retry_base_seconds,
                "retry_max_seconds": retry_max_seconds,
                "retry_jitter_pct": retry_jitter_pct,
                "dedup_hours": dedup_hours,
                "lock_timeout_seconds": lock_timeout_seconds,
            },
        }

    return {
        "date_utc": date_utc,
        "alerts_count": len(alerts),
        "alerts": [asdict(item) for item in alerts],
        "dry_run": False,
        "channels_enabled": enabled_channels,
        "queue": {
            "active_count": len(state.get("active") or []),
            "active_before": active_before,
            "enqueued": queue_stats["enqueued"],
            "skipped_duplicate": queue_stats["skipped_duplicate"],
            "skipped_no_destinations": queue_stats["skipped_no_destinations"],
            "dead_letters": len(state.get("dead_letters") or []),
        },
        "delivery": {
            "sent_attempts": process_stats["sent_attempts"],
            "failed_attempts": process_stats["failed_attempts"],
            "retried_items": process_stats["retried_items"],
            "delivered_items": process_stats["delivered_items"],
            "dead_letter_items": process_stats["dead_letter_items"],
        },
        "policy": {
            "retry_max": retry_max,
            "retry_base_seconds": retry_base_seconds,
            "retry_max_seconds": retry_max_seconds,
            "retry_jitter_pct": retry_jitter_pct,
            "dedup_hours": dedup_hours,
            "lock_timeout_seconds": lock_timeout_seconds,
        },
    }
