from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json


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


def _send_slack(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"text": text}, timeout=20)
    response.raise_for_status()


def _send_discord(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"content": text}, timeout=20)
    response.raise_for_status()


def run_alerts(
    *,
    date_utc: str,
    dry_run: bool = False,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    alerts = _collect_alerts(date_utc, settings)
    text_lines = [f"RootFetch alerts for {date_utc}"]
    text_lines.extend([f"- [{item.severity}] {item.message}" for item in alerts])
    text = "\n".join(text_lines)

    slack_url = os.getenv("ROOTFETCH_SLACK_WEBHOOK_URL", "").strip()
    discord_url = os.getenv("ROOTFETCH_DISCORD_WEBHOOK_URL", "").strip()

    sends: list[str] = []
    if dry_run:
        return {
            "date_utc": date_utc,
            "alerts_count": len(alerts),
            "alerts": [item.__dict__ for item in alerts],
            "dry_run": True,
            "would_send": {
                "slack": bool(slack_url),
                "discord": bool(discord_url),
            },
            "preview": text,
        }

    if not alerts:
        return {
            "date_utc": date_utc,
            "alerts_count": 0,
            "alerts": [],
            "dry_run": False,
            "sent": [],
        }

    if slack_url:
        _send_slack(slack_url, text)
        sends.append("slack")
    if discord_url:
        _send_discord(discord_url, text)
        sends.append("discord")

    return {
        "date_utc": date_utc,
        "alerts_count": len(alerts),
        "alerts": [item.__dict__ for item in alerts],
        "dry_run": False,
        "sent": sends,
    }
