from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json


def _fmt_int(value: Any) -> str:
    try:
        if value is None:
            return "n/a"
        return f"{int(float(value)):,}"
    except Exception:
        return "n/a"


def _fmt_float(value: Any, *, digits: int = 2) -> str:
    try:
        if value is None:
            return "n/a"
        return f"{float(value):.{digits}f}"
    except Exception:
        return "n/a"


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
    top_tlds_path = settings.signals_dir / f"{date_utc}_top_tlds.csv"
    daily_counts_path = settings.daily_counts_dir / f"{date_utc}.csv"

    movers_df = _safe_read_csv(movers_path)
    anomalies_df = _safe_read_csv(anomalies_path)
    rolling_df = _safe_read_csv(rolling_updates_path)
    sectors_df = _safe_read_csv(sector_snapshot_path)
    top_tlds_df = _safe_read_csv(top_tlds_path)
    daily_df = _safe_read_csv(daily_counts_path)

    abs_growers = movers_df[movers_df.get("leaderboard", "") == "top_abs_growers"] if not movers_df.empty else pd.DataFrame()
    pct_growers = movers_df[movers_df.get("leaderboard", "") == "top_pct_growers"] if not movers_df.empty else pd.DataFrame()
    decliners = movers_df[movers_df.get("leaderboard", "") == "top_abs_decliners"] if not movers_df.empty else pd.DataFrame()

    failed_count = 0
    estimate_count = 0
    run_mode = "daily"
    if not daily_df.empty:
        failed_count = int((daily_df.get("status") == "failed").sum())
        estimate_count = int(daily_df.get("is_estimate").astype(str).str.lower().isin({"true", "1", "yes"}).sum())
        cadence = daily_df.get("cadence")
        if cadence is None:
            cadence = pd.Series(["legacy"] * len(daily_df))
        cadence = cadence.astype(str).str.strip().str.lower()
        baseline_rows = int((cadence == "baseline").sum())
        core_rows = int((cadence == "core").sum())
        rolling_rows = int((cadence == "rolling").sum())
        if baseline_rows > 0 and core_rows == 0 and rolling_rows == 0:
            run_mode = "baseline"
        elif core_rows > 0 or rolling_rows > 0:
            run_mode = "hybrid"

    distribution = latest_payload.get("distribution", {}) if isinstance(latest_payload.get("distribution"), dict) else {}
    concentration = latest_payload.get("concentration", {}) if isinstance(latest_payload.get("concentration"), dict) else {}
    approvals_diff = latest_payload.get("approvals_diff", {}) if isinstance(latest_payload.get("approvals_diff"), dict) else {}
    security_status = latest_payload.get("security_status", {}) if isinstance(latest_payload.get("security_status"), dict) else {}
    insights_raw = latest_payload.get("insights", [])
    insights: list[dict[str, Any]] = []
    if isinstance(insights_raw, list):
        for item in insights_raw:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            insights.append(
                {
                    "kind": str(item.get("kind") or "insight"),
                    "severity": str(item.get("severity") or "info"),
                    "text": text,
                }
            )
    top_tlds_preview = approvals_diff.get("added_preview", [])
    if not isinstance(top_tlds_preview, list):
        top_tlds_preview = []

    digest_lines = [
        f"# RootFetch Daily Digest — {date_utc}",
        "",
        f"- Run ID: {run_id or latest_payload.get('run_id', 'unknown')}",
        f"- Mode: {run_mode}",
        f"- Approved TLDs observed: {latest_payload.get('approved_tlds_count', 'n/a')}",
        f"- Observed today: {latest_payload.get('counted_today_count', 'n/a')} (core={latest_payload.get('counted_today_core_count', 'n/a')}, rolling={latest_payload.get('counted_today_rolling_count', 'n/a')})",
        f"- Snapshot rows today: {latest_payload.get('snapshot_rows_today', latest_payload.get('processed_tlds_count_today', 'n/a'))}",
        "",
        "## Cross-sectional highlights",
        f"- Total delegated counted today: {_fmt_int(latest_payload.get('total_delegated_counted_today', latest_payload.get('total_delegated_domains_today')))}",
        f"- Distribution (p50 / p90 / p99 / max): {_fmt_int(distribution.get('p50'))} / {_fmt_int(distribution.get('p90'))} / {_fmt_int(distribution.get('p99'))} / {_fmt_int(distribution.get('max'))}",
        f"- Concentration (Top1 / Top10 share): {_fmt_float(concentration.get('top1_share_pct'), digits=2)}% / {_fmt_float(concentration.get('top10_share_pct'), digits=2)}% (HHI={_fmt_float(concentration.get('hhi'), digits=4)})",
        f"- New approvals vs {approvals_diff.get('prev_date_utc') or 'n/a'}: +{approvals_diff.get('added_count', 0)} / -{approvals_diff.get('removed_count', 0)}",
        (
            "- Added approvals (first 10): "
            + ", ".join(top_tlds_preview[:10])
            if top_tlds_preview
            else "- Added approvals (first 10): none"
        ),
        "",
        "## Daily Insights",
        (
            "\n".join(
                [
                    f"- [{item['kind']}/{item['severity']}] {item['text']}"
                    for item in insights
                ]
            )
            if insights
            else "- No generated insight lines for this run."
        ),
        "",
        "## Security Status",
        f"- Safe aggregates checks date: {security_status.get('date_utc', 'n/a')}",
        f"- no_raw_zones_tracked: {security_status.get('no_raw_zones_tracked', 'n/a')}",
        f"- no_ai_dir_tracked: {security_status.get('no_ai_dir_tracked', 'n/a')}",
        f"- no_env_tracked: {security_status.get('no_env_tracked', 'n/a')}",
        f"- vercel_read_only: {security_status.get('vercel_read_only', 'n/a')}",
        "",
        "## Top TLDs by Count (Today)",
        _render_table(top_tlds_df, ["tld", "count", "share_pct", "sector", "cadence"], limit=10),
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
