from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json


SUPPORTED_CHANNELS = ("slack", "discord")


@dataclass
class AlertItem:
    code: str
    severity: str
    message: str


def _safe_read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def _safe_read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = read_json(path)
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


def _delivery_log_path(settings: Settings) -> Path:
    return _alerts_dir(settings) / "delivery_log.jsonl"


def _load_state(settings: Settings) -> dict[str, Any]:
    path = _state_path(settings)
    if not path.exists():
        return {
            "version": 1,
            "active": [],
            "delivered_index": {},
            "dead_letters": [],
            "updated_at_utc": _iso(_now_utc()),
        }
    payload = _safe_read_json(path)
    if not payload:
        return {
            "version": 1,
            "active": [],
            "delivered_index": {},
            "dead_letters": [],
            "updated_at_utc": _iso(_now_utc()),
        }
    payload["version"] = int(payload.get("version") or 1)
    payload["active"] = list(payload.get("active") or [])
    payload["delivered_index"] = dict(payload.get("delivered_index") or {})
    payload["dead_letters"] = list(payload.get("dead_letters") or [])
    payload["updated_at_utc"] = str(payload.get("updated_at_utc") or _iso(_now_utc()))
    return payload


def _save_state(settings: Settings, state: dict[str, Any]) -> None:
    state["updated_at_utc"] = _iso(_now_utc())
    _state_path(settings).write_text(json.dumps(state, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def _append_delivery_log(settings: Settings, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path = _delivery_log_path(settings)
    with path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")


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
            alerts.append(
                AlertItem(
                    code="core_mover",
                    severity="warning",
                    message=(
                        f"Core mover {row.get('tld')}: delta_abs={int(row.get('delta_abs_num') or 0):,} "
                        f"delta_pct={(float(row.get('delta_pct_num') or 0) * 100):.2f}%"
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
            alerts.append(
                AlertItem(
                    code="anomaly",
                    severity="warning",
                    message=(
                        f"Anomaly {row.get('tld')}: reason={row.get('reason')}, "
                        f"z={float(row.get('z_num') or 0):.2f}, robust_z={float(row.get('robust_z_num') or 0):.2f}"
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
            )
        )

    return alerts


def _fingerprint(date_utc: str, item: AlertItem) -> str:
    raw = f"{date_utc}|{item.code}|{item.severity}|{item.message}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _enabled_targets() -> dict[str, str]:
    targets = {
        "slack": os.getenv("ROOTFETCH_SLACK_WEBHOOK_URL", "").strip(),
        "discord": os.getenv("ROOTFETCH_DISCORD_WEBHOOK_URL", "").strip(),
    }
    return {channel: url for channel, url in targets.items() if url}


def _send_slack(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"text": text}, timeout=20)
    response.raise_for_status()


def _send_discord(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"content": text}, timeout=20)
    response.raise_for_status()


def _send_channel(channel: str, webhook_url: str, text: str) -> None:
    if channel == "slack":
        _send_slack(webhook_url, text)
        return
    if channel == "discord":
        _send_discord(webhook_url, text)
        return
    raise RuntimeError(f"unsupported channel: {channel}")


def _delivery_text(date_utc: str, item: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"RootFetch alerts for {date_utc}",
            f"- [{item.get('severity')}] {item.get('message')}",
        ]
    )


def _backoff_seconds(attempts: int, *, base_seconds: int, max_seconds: int) -> int:
    exponent = max(0, attempts - 1)
    delay = base_seconds * (2 ** exponent)
    return int(min(max_seconds, max(base_seconds, delay)))


def _trim_delivered_index(delivered_index: dict[str, str], *, now: datetime, horizon_days: int = 30) -> dict[str, str]:
    out: dict[str, str] = {}
    cutoff = now - timedelta(days=horizon_days)
    for fingerprint, sent_at in delivered_index.items():
        parsed = _parse_utc(sent_at)
        if parsed is None:
            continue
        if parsed >= cutoff:
            out[str(fingerprint)] = _iso(parsed)
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
    active_fingerprints = {str(item.get("fingerprint")) for item in active}
    delivered_index = dict(state.get("delivered_index") or {})

    enqueued = 0
    skipped_duplicate = 0
    skipped_no_destinations = 0

    for alert in alerts:
        fingerprint = _fingerprint(date_utc, alert)
        if fingerprint in active_fingerprints:
            skipped_duplicate += 1
            continue

        delivered_at = _parse_utc(delivered_index.get(fingerprint))
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
                "id": f"{date_utc}:{fingerprint[:12]}",
                "date_utc": date_utc,
                "code": alert.code,
                "severity": alert.severity,
                "message": alert.message,
                "fingerprint": fingerprint,
                "created_at_utc": _iso(now),
                "next_attempt_at_utc": _iso(now),
                "max_attempts": int(max_attempts),
                "channels": channels,
            }
        )
        active_fingerprints.add(fingerprint)
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
            if str(channel_state.get("status") or "pending") == "pending"
        ]
        if not pending_channels:
            next_active.append(item)
            continue

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
                # Channel currently unavailable: keep pending for future runs.
                continue

            text = _delivery_text(str(item.get("date_utc") or ""), item)
            timestamp = _iso(now)
            try:
                _send_channel(channel, url, text)
            except Exception as exc:
                attempts += 1
                channel_state["attempts"] = attempts
                channel_state["last_attempt_at_utc"] = timestamp
                channel_state["last_error"] = str(exc)
                channel_state["status"] = "pending" if attempts < max_attempts else "dead_letter"
                channels[channel] = channel_state
                failed_attempts += 1
                item_had_failure = True
                attempts_log.append(
                    {
                        "at_utc": timestamp,
                        "alert_id": item.get("id"),
                        "date_utc": item.get("date_utc"),
                        "fingerprint": item.get("fingerprint"),
                        "channel": channel,
                        "result": channel_state["status"],
                        "error": str(exc),
                    }
                )
            else:
                attempts += 1
                channel_state["attempts"] = attempts
                channel_state["last_attempt_at_utc"] = timestamp
                channel_state["last_error"] = ""
                channel_state["status"] = "sent"
                channel_state["sent_at_utc"] = timestamp
                channels[channel] = channel_state
                sent_attempts += 1
                attempts_log.append(
                    {
                        "at_utc": timestamp,
                        "alert_id": item.get("id"),
                        "date_utc": item.get("date_utc"),
                        "fingerprint": item.get("fingerprint"),
                        "channel": channel,
                        "result": "sent",
                        "error": "",
                    }
                )

        item["channels"] = channels
        pending_after = [
            channel
            for channel, channel_state in channels.items()
            if str(channel_state.get("status") or "pending") == "pending"
        ]
        sent_after = [
            channel
            for channel, channel_state in channels.items()
            if str(channel_state.get("status") or "") == "sent"
        ]
        dead_after = [
            channel
            for channel, channel_state in channels.items()
            if str(channel_state.get("status") or "") == "dead_letter"
        ]

        if pending_after:
            max_attempts_so_far = max(
                int((channels[channel] or {}).get("attempts") or 0)
                for channel in pending_after
            )
            delay_seconds = _backoff_seconds(
                max_attempts_so_far,
                base_seconds=retry_base_seconds,
                max_seconds=retry_max_seconds,
            )
            item["next_attempt_at_utc"] = _iso(now + timedelta(seconds=delay_seconds))
            next_active.append(item)
            if item_had_failure:
                retried_items += 1
            continue

        if sent_after:
            delivered_items += 1
            delivered_index[str(item.get("fingerprint"))] = _iso(now)

        if dead_after:
            dead_letter_items += 1
            dead_letters.append(
                {
                    "id": item.get("id"),
                    "date_utc": item.get("date_utc"),
                    "fingerprint": item.get("fingerprint"),
                    "code": item.get("code"),
                    "severity": item.get("severity"),
                    "message": item.get("message"),
                    "channels": channels,
                    "finalized_at_utc": _iso(now),
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
    dedup_hours = max(0, _int_env("ROOTFETCH_ALERT_DEDUP_HOURS", 24))

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

    if dry_run:
        return {
            "date_utc": date_utc,
            "alerts_count": len(alerts),
            "alerts": [item.__dict__ for item in alerts],
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
                "dedup_hours": dedup_hours,
            },
        }

    process_stats = _process_queue(
        state=state,
        now=now,
        targets=targets,
        retry_base_seconds=retry_base_seconds,
        retry_max_seconds=retry_max_seconds,
    )
    _save_state(settings, state)
    _append_delivery_log(settings, process_stats["attempts_log"])

    return {
        "date_utc": date_utc,
        "alerts_count": len(alerts),
        "alerts": [item.__dict__ for item in alerts],
        "dry_run": False,
        "channels_enabled": enabled_channels,
        "queue": {
            "active_count": len(state.get("active") or []),
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
            "dedup_hours": dedup_hours,
        },
    }
