from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json


def _safe_read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def _render_table(df: pd.DataFrame, columns: list[str], limit: int = 10) -> str:
    if df.empty:
        return "_No data._\n"
    subset = df[columns].head(limit)
    headers = [str(col) for col in subset.columns]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for _, row in subset.iterrows():
        values = []
        for col in headers:
            value = row[col]
            if pd.isna(value):
                values.append("")
            else:
                values.append(str(value).replace("\n", " ").replace("|", "\\|"))
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines) + "\n"


def write_daily_digest(date_utc: str, *, run_id: str | None = None, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    settings.digests_dir.mkdir(parents=True, exist_ok=True)
    settings.signals_dir.mkdir(parents=True, exist_ok=True)

    latest_payload: dict[str, Any] = {}
    if settings.latest_signals_path.exists():
        payload = read_json(settings.latest_signals_path)
        if isinstance(payload, dict):
            latest_payload = payload

    movers_path = settings.signals_dir / f"{date_utc}_core_top_movers.csv"
    anomalies_path = settings.signals_dir / f"{date_utc}_anomalies.csv"
    rolling_updates_path = settings.signals_dir / f"{date_utc}_rolling_updates.csv"
    sector_snapshot_path = settings.signals_dir / f"{date_utc}_sector_snapshot.csv"
    daily_counts_path = settings.daily_counts_dir / f"{date_utc}.csv"

    movers_df = _safe_read_csv(movers_path)
    anomalies_df = _safe_read_csv(anomalies_path)
    rolling_df = _safe_read_csv(rolling_updates_path)
    sectors_df = _safe_read_csv(sector_snapshot_path)
    daily_df = _safe_read_csv(daily_counts_path)

    abs_growers = movers_df[movers_df.get("leaderboard", "") == "top_abs_growers"] if not movers_df.empty else pd.DataFrame()
    pct_growers = movers_df[movers_df.get("leaderboard", "") == "top_pct_growers"] if not movers_df.empty else pd.DataFrame()
    decliners = movers_df[movers_df.get("leaderboard", "") == "top_abs_decliners"] if not movers_df.empty else pd.DataFrame()

    failed_count = 0
    estimate_count = 0
    if not daily_df.empty:
        failed_count = int((daily_df.get("status") == "failed").sum())
        estimate_count = int(daily_df.get("is_estimate").astype(str).str.lower().isin({"true", "1", "yes"}).sum())

    digest_lines = [
        f"# RootFetch Daily Digest — {date_utc}",
        "",
        f"- Run ID: {run_id or latest_payload.get('run_id', 'unknown')}",
        f"- Approved TLDs observed: {latest_payload.get('approved_tlds_count', 'n/a')}",
        f"- Counted today: {latest_payload.get('counted_today_count', 'n/a')} (core={latest_payload.get('counted_today_core_count', 'n/a')}, rolling={latest_payload.get('counted_today_rolling_count', 'n/a')})",
        "",
        "## Core Daily Movers (Absolute)",
        _render_table(abs_growers, ["tld", "count", "delta_abs", "delta_pct", "data_quality"]),
        "## Core Daily Movers (Percentage)",
        _render_table(pct_growers, ["tld", "count", "delta_abs", "delta_pct", "data_quality"]),
        "## Core Daily Decliners",
        _render_table(decliners, ["tld", "count", "delta_abs", "delta_pct", "data_quality"]),
        "## Rolling Updates (Since Last Seen)",
        _render_table(rolling_df, ["tld", "count", "prev_date_utc", "days_since_prev", "delta_abs", "delta_pct"]),
        "## Notable Anomalies",
        _render_table(anomalies_df, ["tld", "reason", "delta_pct", "z", "robust_z", "data_quality"]),
        "## Sector Snapshot",
        _render_table(sectors_df, ["sector", "sector_count", "sector_delta_abs", "sector_delta_pct", "member_tlds_count"]),
        "## Data Quality Notes",
        f"- Failed TLD jobs: {failed_count}",
        f"- Estimated counts (HLL): {estimate_count}",
    ]
    content = "\n".join(digest_lines).rstrip() + "\n"

    dated_digest_path = settings.digests_dir / f"{date_utc}.md"
    latest_digest_path = settings.digests_dir / "latest.md"
    dated_digest_path.write_text(content, encoding="utf-8")
    latest_digest_path.write_text(content, encoding="utf-8")

    return {
        "dated_digest_path": dated_digest_path,
        "latest_digest_path": latest_digest_path,
    }
