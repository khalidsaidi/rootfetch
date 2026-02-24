from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from rootfetch.config import Settings, get_settings


def latest_data_date(settings: Settings) -> str | None:
    latest_json = settings.latest_signals_path
    if latest_json.exists():
        try:
            payload = json.loads(latest_json.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and payload.get("date_utc"):
                return str(payload["date_utc"])
        except Exception:
            pass
    candidates = sorted(settings.daily_counts_dir.glob("*.csv"))
    if candidates:
        return candidates[-1].stem
    return None


def _read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Resource file not found: {path}")
    return path.read_text(encoding="utf-8")


def _resolve_date(date: str, settings: Settings) -> str:
    if date == "latest":
        resolved = latest_data_date(settings)
        if not resolved:
            raise FileNotFoundError("No latest data date found.")
        return resolved
    return date


def get_latest_signals_text(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return _read_text(settings.latest_signals_path)


def get_growth_trends_text(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return _read_text(settings.growth_trends_path)


def get_daily_counts_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    resolved = _resolve_date(date, settings)
    return _read_text(settings.daily_counts_dir / f"{resolved}.csv")


def get_approved_tlds_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    resolved = _resolve_date(date, settings)
    return _read_text(settings.approved_dir / f"{resolved}.json")


def get_digest_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    if date == "latest":
        return _read_text(settings.digests_dir / "latest.md")
    return _read_text(settings.digests_dir / f"{date}.md")


def get_metrics_spec_text(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return _read_text(settings.docs_dir / "metrics_spec.md")


def get_signal_spec_text(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return _read_text(settings.docs_dir / "signal_spec.md")


def get_top_movers_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    resolved = _resolve_date(date, settings)
    return _read_text(settings.signals_dir / f"{resolved}_top_movers.csv")


def get_anomalies_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    resolved = _resolve_date(date, settings)
    return _read_text(settings.signals_dir / f"{resolved}_anomalies.csv")


def get_sector_snapshot_text(date: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    resolved = _resolve_date(date, settings)
    return _read_text(settings.signals_dir / f"{resolved}_sector_snapshot.csv")


def register_resources(mcp: FastMCP) -> None:
    @mcp.resource("rootfetch://signals/latest")
    def resource_latest() -> str:
        return get_latest_signals_text()

    @mcp.resource("rootfetch://growth_trends")
    def resource_growth_trends() -> str:
        return get_growth_trends_text()

    @mcp.resource("rootfetch://daily_counts/{date}")
    def resource_daily_counts(date: str) -> str:
        return get_daily_counts_text(date)

    @mcp.resource("rootfetch://approved_tlds/{date}")
    def resource_approved(date: str) -> str:
        return get_approved_tlds_text(date)

    @mcp.resource("rootfetch://digest/latest")
    def resource_digest_latest() -> str:
        return get_digest_text("latest")

    @mcp.resource("rootfetch://digest/{date}")
    def resource_digest(date: str) -> str:
        return get_digest_text(date)

    @mcp.resource("rootfetch://docs/metrics_spec")
    def resource_metrics() -> str:
        return get_metrics_spec_text()

    @mcp.resource("rootfetch://docs/signal_spec")
    def resource_signal_spec() -> str:
        return get_signal_spec_text()

    @mcp.resource("rootfetch://signals/top_movers/{date}")
    def resource_top_movers(date: str) -> str:
        return get_top_movers_text(date)

    @mcp.resource("rootfetch://signals/anomalies/{date}")
    def resource_anomalies(date: str) -> str:
        return get_anomalies_text(date)

    @mcp.resource("rootfetch://signals/sector_snapshot/{date}")
    def resource_sector_snapshot(date: str) -> str:
        return get_sector_snapshot_text(date)
