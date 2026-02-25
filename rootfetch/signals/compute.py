from __future__ import annotations

import math
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json, utc_now_iso, write_json
from rootfetch.signals.coverage import compute_coverage_latest


TOP_MOVERS_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "delta_abs",
    "delta_pct",
    "accel_abs",
    "is_estimate",
    "data_quality",
    "leaderboard",
]

ROLLING_UPDATES_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "prev_date_utc",
    "days_since_prev",
    "delta_abs",
    "delta_pct",
    "cadence",
    "status",
    "is_estimate",
    "data_quality",
]

VOLATILITY_COLUMNS = [
    "date_utc",
    "tld",
    "vol7",
    "vol30",
    "valid_days_30",
    "is_estimate",
    "data_quality",
]

ANOMALY_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "delta_pct",
    "z",
    "robust_z",
    "baseline_days",
    "reason",
    "is_estimate",
    "data_quality",
]

SECTOR_COLUMNS = [
    "date_utc",
    "sector",
    "sector_count",
    "sector_delta_abs",
    "sector_delta_pct",
    "member_tlds_count",
    "notes",
]

TOP_TLDS_COLUMNS = [
    "date_utc",
    "tld",
    "count",
    "sector",
    "share_pct",
    "cadence",
    "is_estimate",
    "status",
]


ENV_TRACKED_PATTERN = re.compile(r"(^|/)\.env($|[./])")


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes"}


def _load_growth_df(settings: Settings) -> pd.DataFrame:
    if not settings.growth_trends_path.exists():
        return pd.DataFrame(
            columns=[
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
        )
    df = pd.read_csv(settings.growth_trends_path, dtype=str)
    for col in ("count", "delta_abs", "delta_pct", "days_since_prev"):
        if col in df.columns:
            df[f"{col}_num"] = pd.to_numeric(df[col], errors="coerce")
        else:
            df[f"{col}_num"] = pd.Series(dtype=float)
    df["is_estimate_bool"] = df.get("is_estimate", "false").map(_to_bool)
    df["approved_today_bool"] = df.get("approved_today", "false").map(_to_bool)
    if "cadence" not in df.columns:
        df["cadence"] = "legacy"
    else:
        df["cadence"] = (
            df["cadence"]
            .astype(str)
            .str.strip()
            .str.lower()
            .replace("", "legacy")
        )
    return df


def _load_daily_df(settings: Settings, date_utc: str) -> pd.DataFrame:
    path = settings.daily_counts_dir / f"{date_utc}.csv"
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path, dtype=str)
    for col in ("count", "count_ds_sld", "count_glue_hosts", "count_ns_rr"):
        if col in df.columns:
            df[f"{col}_num"] = pd.to_numeric(df[col], errors="coerce")
    if "is_estimate" in df.columns:
        df["is_estimate_bool"] = df["is_estimate"].map(_to_bool)
    if "cadence" not in df.columns:
        df["cadence"] = "legacy"
    else:
        df["cadence"] = (
            df["cadence"]
            .astype(str)
            .str.strip()
            .str.lower()
            .replace("", "legacy")
        )
    return df


def _ensure_signal_dir(settings: Settings) -> None:
    settings.signals_dir.mkdir(parents=True, exist_ok=True)


def _with_quality_flags(day_df: pd.DataFrame) -> pd.DataFrame:
    if day_df.empty:
        day_df["data_quality"] = []
        return day_df
    day_df = day_df.copy()
    day_df["data_quality"] = "ok"
    day_df.loc[day_df["status"] != "ok", "data_quality"] = "failed"
    day_df.loc[(day_df["status"] == "ok") & (day_df["count_num"].isna()), "data_quality"] = "missing"
    day_df.loc[(day_df["status"] == "ok") & (day_df["is_estimate_bool"]), "data_quality"] = "estimate"

    previous_count = day_df["count_num"] - day_df["delta_abs_num"]
    suspicious = (
        day_df["status"].eq("ok")
        & day_df["delta_pct_num"].abs().gt(0.20)
        & previous_count.gt(10_000)
        & ~day_df["approved_today_bool"]
    )
    day_df.loc[suspicious, "data_quality"] = "suspicious"
    day_df["previous_count"] = previous_count
    return day_df


def _compute_core_top_movers(day_df: pd.DataFrame, date_utc: str, settings: Settings) -> pd.DataFrame:
    if day_df.empty:
        return pd.DataFrame(columns=TOP_MOVERS_COLUMNS)

    cadence_series = day_df.get("cadence", "").astype(str).str.lower()
    core = day_df[(cadence_series == "core") & (day_df["days_since_prev_num"] == 1)].copy()
    valid = core[
        (core["status"] == "ok")
        & (core["count_num"].notna())
        & (core["delta_abs_num"].notna())
    ].copy()
    if valid.empty:
        return pd.DataFrame(columns=TOP_MOVERS_COLUMNS)

    abs_growers = valid.sort_values("delta_abs_num", ascending=False).head(20).copy()
    abs_growers["leaderboard"] = "top_abs_growers"

    pct_growers = valid[
        valid["previous_count"].fillna(0) >= settings.min_base_for_pct
    ].sort_values("delta_pct_num", ascending=False).head(20).copy()
    pct_growers["leaderboard"] = "top_pct_growers"

    decliners = valid.sort_values("delta_abs_num", ascending=True).head(20).copy()
    decliners["leaderboard"] = "top_abs_decliners"

    out = pd.concat([abs_growers, pct_growers, decliners], ignore_index=True)
    out["date_utc"] = date_utc
    out["count"] = out["count_num"]
    out["delta_abs"] = out["delta_abs_num"]
    out["delta_pct"] = out["delta_pct_num"]
    out["accel_abs"] = out["accel_abs_num"]
    out["is_estimate"] = out["is_estimate_bool"]
    return out[TOP_MOVERS_COLUMNS]


def _compute_rolling_updates(day_df: pd.DataFrame, date_utc: str) -> pd.DataFrame:
    if day_df.empty:
        return pd.DataFrame(columns=ROLLING_UPDATES_COLUMNS)
    working = day_df[
        (day_df["status"] == "ok")
        & (day_df["count_num"].notna())
    ].copy()
    if working.empty:
        return pd.DataFrame(columns=ROLLING_UPDATES_COLUMNS)

    cadence_series = (
        working["cadence"].astype(str).str.strip().str.lower()
        if "cadence" in working.columns
        else pd.Series(["legacy"] * len(working), index=working.index, dtype=str)
    )
    prev_series = (
        working["prev_date_utc"]
        if "prev_date_utc" in working.columns
        else pd.Series([""] * len(working), index=working.index, dtype=str)
    )
    days_since_prev_series = (
        working["days_since_prev_num"]
        if "days_since_prev_num" in working.columns
        else pd.Series([math.nan] * len(working), index=working.index, dtype=float)
    )
    prev_missing = prev_series.fillna("").astype(str).str.strip().eq("")
    first_seen_mask = prev_missing | days_since_prev_series.isna()
    rolling_mask = (cadence_series == "rolling") & working["delta_abs_num"].notna()

    selected = working[rolling_mask | first_seen_mask].copy()
    if selected.empty:
        return pd.DataFrame(columns=ROLLING_UPDATES_COLUMNS)

    selected["date_utc"] = date_utc
    selected["count"] = selected["count_num"]
    selected["delta_abs"] = selected["delta_abs_num"]
    selected["delta_pct"] = selected["delta_pct_num"]
    selected["is_estimate"] = selected["is_estimate_bool"]
    selected["cadence"] = (
        selected["cadence"].astype(str).str.strip().str.lower().replace("", "legacy")
        if "cadence" in selected.columns
        else "legacy"
    )
    selected["status"] = (
        selected["status"].astype(str).str.strip().str.lower()
        if "status" in selected.columns
        else "ok"
    )
    selected["is_first_seen"] = (
        selected["prev_date_utc"].fillna("").astype(str).str.strip().eq("")
        if "prev_date_utc" in selected.columns
        else True
    )
    selected.loc[selected["is_first_seen"], ["prev_date_utc", "days_since_prev", "delta_abs", "delta_pct"]] = None
    selected["abs_delta"] = selected["delta_abs_num"].abs()
    selected = selected.sort_values(
        ["is_first_seen", "abs_delta", "count_num", "tld"],
        ascending=[True, False, False, True],
        na_position="last",
    )
    return selected[ROLLING_UPDATES_COLUMNS]


def _compute_volatility(growth_df: pd.DataFrame, day_df: pd.DataFrame, date_utc: str) -> pd.DataFrame:
    if day_df.empty:
        return pd.DataFrame(columns=VOLATILITY_COLUMNS)
    rows: list[dict[str, Any]] = []
    growth_sorted = growth_df.sort_values(["tld", "date_utc"])
    for _, current in day_df.iterrows():
        tld = current["tld"]
        history = growth_sorted[
            (growth_sorted["tld"] == tld)
            & (growth_sorted["date_utc"] <= date_utc)
            & (growth_sorted["status"] == "ok")
            & (growth_sorted["delta_pct_num"].notna())
        ]["delta_pct_num"]
        tail30 = history.tail(30)
        tail7 = history.tail(7)
        vol7 = float(tail7.std(ddof=0)) if len(tail7) >= 7 else math.nan
        vol30 = float(tail30.std(ddof=0)) if len(tail30) >= 30 else math.nan
        rows.append(
            {
                "date_utc": date_utc,
                "tld": tld,
                "vol7": vol7,
                "vol30": vol30,
                "valid_days_30": int(len(tail30)),
                "is_estimate": bool(current.get("is_estimate_bool", False)),
                "data_quality": current.get("data_quality", "ok"),
            }
        )
    out = pd.DataFrame(rows, columns=VOLATILITY_COLUMNS)
    if not out.empty and out["vol30"].notna().any():
        out["vol_rank"] = out["vol30"].rank(ascending=False, method="dense")
        out = out.sort_values(["vol_rank", "tld"], na_position="last")
    return out[VOLATILITY_COLUMNS]


def _load_sector_map(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {"other": ["*"]}
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    sectors = payload.get("sectors", {})
    if not isinstance(sectors, dict):
        return {"other": ["*"]}
    normalized: dict[str, list[str]] = {}
    for sector, members in sectors.items():
        if isinstance(members, list):
            normalized[str(sector)] = [str(item).strip().lower() for item in members if str(item).strip()]
    return normalized or {"other": ["*"]}


def _map_tld_to_sectors(tld: str, sector_map: dict[str, list[str]]) -> list[str]:
    tld = tld.lower()
    matched = [sector for sector, members in sector_map.items() if tld in members]
    if matched:
        return matched
    fallback = [sector for sector, members in sector_map.items() if "*" in members]
    if fallback:
        return fallback
    return ["other"]


def _compute_sector_rows(
    date_utc: str,
    day_df: pd.DataFrame,
    settings: Settings,
) -> pd.DataFrame:
    sector_map = _load_sector_map(settings.sector_map_path)
    ok_rows = day_df[(day_df["status"] == "ok") & day_df["count_num"].notna()].copy()
    bucket: dict[str, dict[str, Any]] = {}
    for _, row in ok_rows.iterrows():
        tld = row["tld"]
        count = float(row["count_num"])
        for sector in _map_tld_to_sectors(tld, sector_map):
            if sector not in bucket:
                bucket[sector] = {"sector_count": 0.0, "member_tlds": set()}
            bucket[sector]["sector_count"] += count
            bucket[sector]["member_tlds"].add(tld)

    rows = []
    for sector, data in sorted(bucket.items()):
        rows.append(
            {
                "date_utc": date_utc,
                "sector": sector,
                "sector_count": int(round(data["sector_count"])),
                "sector_delta_abs": None,
                "sector_delta_pct": None,
                "member_tlds_count": len(data["member_tlds"]),
                "notes": "",
            }
        )
    return pd.DataFrame(rows, columns=SECTOR_COLUMNS)


def _upsert_sector_indices(today_rows: pd.DataFrame, settings: Settings) -> pd.DataFrame:
    path = settings.signals_dir / "sector_indices.csv"
    if path.exists():
        existing = pd.read_csv(path, dtype=str)
        for col in ("sector_count", "sector_delta_abs", "sector_delta_pct", "member_tlds_count"):
            existing[f"{col}_num"] = pd.to_numeric(existing[col], errors="coerce")
    else:
        existing = pd.DataFrame(columns=SECTOR_COLUMNS)

    if not today_rows.empty:
        existing = existing[existing["date_utc"] != today_rows.iloc[0]["date_utc"]]

    combined = pd.concat([existing[SECTOR_COLUMNS], today_rows[SECTOR_COLUMNS]], ignore_index=True)
    combined = combined.sort_values(["sector", "date_utc"])
    combined["sector_count_num"] = pd.to_numeric(combined["sector_count"], errors="coerce")
    combined["prev_sector_count"] = combined.groupby("sector")["sector_count_num"].shift(1)
    combined["sector_delta_abs"] = combined["sector_count_num"] - combined["prev_sector_count"]
    combined["sector_delta_pct"] = combined["sector_delta_abs"] / combined["prev_sector_count"]
    combined.loc[combined["prev_sector_count"].isna(), ["sector_delta_abs", "sector_delta_pct"]] = None
    combined["member_tlds_count"] = pd.to_numeric(combined["member_tlds_count"], errors="coerce").fillna(0).astype(int)
    combined = combined.sort_values(["date_utc", "sector"])
    combined[SECTOR_COLUMNS].to_csv(path, index=False)
    return combined[SECTOR_COLUMNS]


def _compute_anomalies(growth_df: pd.DataFrame, day_df: pd.DataFrame, date_utc: str) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    growth_sorted = growth_df.sort_values(["tld", "date_utc"])
    for _, current in day_df.iterrows():
        if current.get("status") != "ok":
            continue
        delta_pct = current.get("delta_pct_num")
        if pd.isna(delta_pct):
            continue

        tld = current["tld"]
        prior = growth_sorted[
            (growth_sorted["tld"] == tld)
            & (growth_sorted["date_utc"] < date_utc)
            & (growth_sorted["status"] == "ok")
            & (growth_sorted["delta_pct_num"].notna())
        ]["delta_pct_num"].tail(30)
        baseline_days = int(len(prior))
        mean = float(prior.mean()) if baseline_days else math.nan
        std = float(prior.std(ddof=0)) if baseline_days else math.nan
        median = float(prior.median()) if baseline_days else math.nan
        mad = float((prior - median).abs().median()) if baseline_days else math.nan

        z = math.nan
        if baseline_days >= 14 and std and not math.isnan(std):
            z = (float(delta_pct) - mean) / std if std > 0 else 0.0
        robust_z = math.nan
        if baseline_days >= 14 and mad and not math.isnan(mad):
            robust_z = 0.6745 * (float(delta_pct) - median) / mad if mad > 0 else 0.0

        latest_prior_row = growth_sorted[(growth_sorted["tld"] == tld) & (growth_sorted["date_utc"] < date_utc)].tail(1)
        previous_status = latest_prior_row.iloc[0]["status"] if not latest_prior_row.empty else None

        reason = None
        if current.get("data_quality") == "suspicious":
            reason = "suspicious_jump"
        elif baseline_days >= 14 and not math.isnan(robust_z) and abs(robust_z) >= 3.5:
            reason = "robust_z"
        elif baseline_days >= 14 and not math.isnan(z) and abs(z) >= 3.0:
            reason = "zscore"
        elif previous_status in {"failed", "missing"}:
            reason = "missing_data_recovery"

        if reason:
            rows.append(
                {
                    "date_utc": date_utc,
                    "tld": tld,
                    "count": current.get("count_num"),
                    "delta_pct": float(delta_pct),
                    "z": z,
                    "robust_z": robust_z,
                    "baseline_days": baseline_days,
                    "reason": reason,
                    "is_estimate": bool(current.get("is_estimate_bool", False)),
                    "data_quality": current.get("data_quality", "ok"),
                }
            )
    return pd.DataFrame(rows, columns=ANOMALY_COLUMNS)


def _counted_today_breakdown(settings: Settings, date_utc: str) -> dict[str, int]:
    daily_df = _load_daily_df(settings, date_utc)
    if daily_df.empty or "status" not in daily_df.columns:
        return {
            "counted_today_count": 0,
            "counted_today_core_count": 0,
            "counted_today_rolling_count": 0,
            "snapshot_rows_today": 0,
            "total_delegated_domains_today": 0,
        }

    ok_rows = daily_df[(daily_df["status"] == "ok") & (daily_df["count_num"].notna())].copy()
    if ok_rows.empty:
        return {
            "counted_today_count": 0,
            "counted_today_core_count": 0,
            "counted_today_rolling_count": 0,
            "snapshot_rows_today": 0,
            "total_delegated_domains_today": 0,
        }

    cadence = ok_rows.get("cadence", "").astype(str).str.lower()
    core_count = int((cadence == "core").sum())
    rolling_count = int((cadence == "rolling").sum())
    observed_today_count = core_count + rolling_count
    snapshot_rows_today = int(len(ok_rows))

    return {
        # Semantics: counted_today_count means observed today (core + rolling).
        "counted_today_count": observed_today_count,
        "counted_today_core_count": core_count,
        "counted_today_rolling_count": rolling_count,
        "snapshot_rows_today": snapshot_rows_today,
        "total_delegated_domains_today": int(ok_rows["count_num"].sum()),
    }


def _daily_ok_rows(day_df: pd.DataFrame) -> pd.DataFrame:
    if day_df.empty:
        return pd.DataFrame(columns=day_df.columns)
    if "count_num" not in day_df.columns:
        day_df = day_df.copy()
        day_df["count_num"] = pd.to_numeric(day_df.get("count"), errors="coerce")
    ok_rows = day_df[(day_df.get("status") == "ok") & day_df["count_num"].notna()].copy()
    if ok_rows.empty:
        return ok_rows

    if "cadence" not in ok_rows.columns:
        ok_rows["cadence"] = "legacy"
    else:
        ok_rows["cadence"] = (
            ok_rows["cadence"]
            .astype(str)
            .str.strip()
            .str.lower()
            .replace("", "legacy")
        )
    if "is_estimate_bool" not in ok_rows.columns:
        ok_rows["is_estimate_bool"] = ok_rows.get("is_estimate", "false").map(_to_bool)
    return ok_rows


def _top_tlds_rows(
    *,
    date_utc: str,
    ok_rows: pd.DataFrame,
    settings: Settings,
    limit: int = 50,
) -> pd.DataFrame:
    if ok_rows.empty:
        return pd.DataFrame(columns=TOP_TLDS_COLUMNS)

    total = float(ok_rows["count_num"].sum())
    sector_map = _load_sector_map(settings.sector_map_path)
    out = ok_rows.copy()
    out["sector"] = out["tld"].map(lambda t: _map_tld_to_sectors(str(t), sector_map)[0])
    out["date_utc"] = date_utc
    out["count"] = out["count_num"].round().astype(int)
    out["share_pct"] = (
        out["count_num"] / total * 100.0
        if total > 0
        else 0.0
    )
    out["is_estimate"] = out["is_estimate_bool"]
    out = out.sort_values(["count_num", "tld"], ascending=[False, True]).head(limit)
    return out[TOP_TLDS_COLUMNS]


def _distribution_payload(
    *,
    date_utc: str,
    ok_rows: pd.DataFrame,
    approved_tlds_count: int,
) -> dict[str, Any]:
    counts = ok_rows["count_num"].astype(float) if not ok_rows.empty else pd.Series(dtype=float)
    total = int(round(float(counts.sum()))) if not counts.empty else 0
    p50 = int(round(float(counts.quantile(0.50)))) if not counts.empty else 0
    p90 = int(round(float(counts.quantile(0.90)))) if not counts.empty else 0
    p99 = int(round(float(counts.quantile(0.99)))) if not counts.empty else 0
    max_count = int(round(float(counts.max()))) if not counts.empty else 0
    min_count = int(round(float(counts.min()))) if not counts.empty else 0
    tiny = int((counts < 100).sum()) if not counts.empty else 0
    small = int((counts < 1000).sum()) if not counts.empty else 0
    return {
        "date_utc": date_utc,
        "approved_tlds_count": int(approved_tlds_count),
        "counted_today_ok": int(len(ok_rows)),
        "total_delegated_counted_today": total,
        "p50": p50,
        "p90": p90,
        "p99": p99,
        "max": max_count,
        "min": min_count,
        "tiny_tlds_lt_100": tiny,
        "small_tlds_lt_1000": small,
    }


def _concentration_payload(
    *,
    date_utc: str,
    ok_rows: pd.DataFrame,
) -> dict[str, Any]:
    if ok_rows.empty:
        return {
            "date_utc": date_utc,
            "total_delegated_counted_today": 0,
            "top1_share_pct": 0.0,
            "top3_share_pct": 0.0,
            "top10_share_pct": 0.0,
            "hhi": 0.0,
        }

    counts = ok_rows["count_num"].astype(float).sort_values(ascending=False)
    total = float(counts.sum())
    if total <= 0:
        return {
            "date_utc": date_utc,
            "total_delegated_counted_today": 0,
            "top1_share_pct": 0.0,
            "top3_share_pct": 0.0,
            "top10_share_pct": 0.0,
            "hhi": 0.0,
        }

    shares = counts / total
    return {
        "date_utc": date_utc,
        "total_delegated_counted_today": int(round(total)),
        "top1_share_pct": float(shares.head(1).sum() * 100.0),
        "top3_share_pct": float(shares.head(3).sum() * 100.0),
        "top10_share_pct": float(shares.head(10).sum() * 100.0),
        "hhi": float((shares * shares).sum()),
    }


def _load_approved_tlds_for_date(settings: Settings, date_utc: str) -> set[str]:
    dated_path = settings.approved_dir / f"{date_utc}.json"
    if dated_path.exists():
        payload = read_json(dated_path)
    else:
        latest_path = settings.approved_dir / "latest.json"
        payload = read_json(latest_path) if latest_path.exists() else {}
    tlds = payload.get("tlds", []) if isinstance(payload, dict) else []
    return {str(t).strip().lower() for t in tlds if str(t).strip()}


def _approvals_diff_payload(settings: Settings, date_utc: str) -> dict[str, Any]:
    current = _load_approved_tlds_for_date(settings, date_utc)
    dated_files = sorted(path.stem for path in settings.approved_dir.glob("????-??-??.json"))
    prev_dates = [stem for stem in dated_files if stem < date_utc]
    prev_date_utc = prev_dates[-1] if prev_dates else ""

    previous: set[str] = set()
    if prev_date_utc:
        prev_path = settings.approved_dir / f"{prev_date_utc}.json"
        if prev_path.exists():
            payload = read_json(prev_path)
            if isinstance(payload, dict):
                previous = {str(t).strip().lower() for t in payload.get("tlds", []) if str(t).strip()}

    added = sorted(current - previous)
    removed = sorted(previous - current)
    return {
        "date_utc": date_utc,
        "prev_date_utc": prev_date_utc,
        "added": added,
        "removed": removed,
        "added_count": len(added),
        "removed_count": len(removed),
    }


def _write_cross_sectional_signals(
    *,
    date_utc: str,
    day_df: pd.DataFrame,
    approved_tlds_count: int,
    settings: Settings,
) -> dict[str, Any]:
    ok_rows = _daily_ok_rows(day_df)
    top_tlds_df = _top_tlds_rows(date_utc=date_utc, ok_rows=ok_rows, settings=settings, limit=50)

    distribution_payload = _distribution_payload(
        date_utc=date_utc,
        ok_rows=ok_rows,
        approved_tlds_count=approved_tlds_count,
    )
    concentration_payload = _concentration_payload(date_utc=date_utc, ok_rows=ok_rows)
    approvals_diff = _approvals_diff_payload(settings, date_utc)

    top_tlds_path = settings.signals_dir / f"{date_utc}_top_tlds.csv"
    top_tlds_latest_path = settings.signals_dir / "top_tlds_latest.csv"
    top_tlds_df.to_csv(top_tlds_path, index=False)
    top_tlds_df.to_csv(top_tlds_latest_path, index=False)

    distribution_path = settings.signals_dir / f"{date_utc}_distribution.json"
    distribution_latest_path = settings.signals_dir / "distribution_latest.json"
    concentration_path = settings.signals_dir / f"{date_utc}_concentration.json"
    concentration_latest_path = settings.signals_dir / "concentration_latest.json"
    approvals_diff_path = settings.signals_dir / f"{date_utc}_approvals_diff.json"
    approvals_diff_latest_path = settings.signals_dir / "approvals_diff_latest.json"

    write_json(distribution_path, distribution_payload)
    write_json(distribution_latest_path, distribution_payload)
    write_json(concentration_path, concentration_payload)
    write_json(concentration_latest_path, concentration_payload)
    write_json(approvals_diff_path, approvals_diff)
    write_json(approvals_diff_latest_path, approvals_diff)

    return {
        "top_tlds_path": top_tlds_path,
        "top_tlds_latest_path": top_tlds_latest_path,
        "distribution_path": distribution_path,
        "distribution_latest_path": distribution_latest_path,
        "concentration_path": concentration_path,
        "concentration_latest_path": concentration_latest_path,
        "approvals_diff_path": approvals_diff_path,
        "approvals_diff_latest_path": approvals_diff_latest_path,
        "top_tlds_df": top_tlds_df,
        "distribution_payload": distribution_payload,
        "concentration_payload": concentration_payload,
        "approvals_diff_payload": approvals_diff,
    }


def _top_rows_as_json(top_df: pd.DataFrame, leaderboard: str) -> list[dict[str, Any]]:
    subset = top_df[top_df["leaderboard"] == leaderboard].head(20)
    return [
        {
            "tld": row["tld"],
            "delta_abs": None if pd.isna(row["delta_abs"]) else float(row["delta_abs"]),
            "delta_pct": None if pd.isna(row["delta_pct"]) else float(row["delta_pct"]),
            "count": None if pd.isna(row["count"]) else int(row["count"]),
        }
        for _, row in subset.iterrows()
    ]


def _top_tlds_as_json(top_tlds_df: pd.DataFrame, limit: int = 10) -> list[dict[str, Any]]:
    subset = top_tlds_df.head(limit)
    return [
        {
            "tld": row["tld"],
            "count": None if pd.isna(row["count"]) else int(row["count"]),
            "share_pct": None if pd.isna(row["share_pct"]) else float(row["share_pct"]),
            "sector": "" if pd.isna(row["sector"]) else str(row["sector"]),
            "cadence": "" if pd.isna(row.get("cadence")) else str(row.get("cadence")),
            "status": "" if pd.isna(row.get("status")) else str(row.get("status")),
            "is_estimate": bool(row.get("is_estimate", False)),
        }
        for _, row in subset.iterrows()
    ]


def _fmt_signed_int(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "n/a"
    try:
        number = int(round(float(value)))
        sign = "+" if number > 0 else ""
        return f"{sign}{number:,}"
    except Exception:
        return "n/a"


def _build_insights(
    *,
    approved_tlds_count: int,
    counted_today_count: int,
    snapshot_rows_today: int,
    missing_ever_count: int,
    distribution_payload: dict[str, Any],
    concentration_payload: dict[str, Any],
    approvals_diff_payload: dict[str, Any],
    core_movers_df: pd.DataFrame,
) -> list[dict[str, str]]:
    insights: list[dict[str, str]] = []

    top10_share = float(concentration_payload.get("top10_share_pct") or 0.0)
    median_size = int(distribution_payload.get("p50") or 0)
    tiny_tlds = int(distribution_payload.get("tiny_tlds_lt_100") or 0)
    insights.append(
        {
            "kind": "market",
            "severity": "info",
            "text": (
                f"Top 10 TLDs hold {top10_share:.2f}% of delegations; "
                f"median TLD has {median_size:,} names; {tiny_tlds:,} TLDs have <100."
            ),
        }
    )

    if not core_movers_df.empty:
        movers = core_movers_df[core_movers_df["leaderboard"] == "top_abs_growers"].head(3)
        if movers.empty:
            mover_text = "Core movers are not available yet for today."
            mover_severity = "neutral"
        else:
            mover_parts = [f".{row['tld']} {_fmt_signed_int(row['delta_abs'])}" for _, row in movers.iterrows()]
            mover_text = f"Core movers: {', '.join(mover_parts)} (day-over-day)."
            mover_severity = "positive"
    else:
        mover_text = "Core movers are not available yet; consecutive core observations are required."
        mover_severity = "neutral"
    insights.append(
        {
            "kind": "movers",
            "severity": mover_severity,
            "text": mover_text,
        }
    )

    added_count = int(approvals_diff_payload.get("added_count") or 0)
    removed_count = int(approvals_diff_payload.get("removed_count") or 0)
    added_preview = list(approvals_diff_payload.get("added") or [])[:3]
    approvals_text = f"New approvals today: +{added_count}"
    if removed_count:
        approvals_text += f", -{removed_count}"
    if added_preview:
        approvals_text += f" ({', '.join(added_preview)})"
    approvals_text += "."
    insights.append(
        {
            "kind": "approvals",
            "severity": "info",
            "text": approvals_text,
        }
    )

    coverage_text = (
        f"Observed today: {counted_today_count:,} (core+rolling) out of "
        f"{approved_tlds_count:,} approved TLDs; snapshot rows today: {snapshot_rows_today:,}."
    )
    if missing_ever_count > 0:
        coverage_text += f" Missing ever: {missing_ever_count:,}."
    insights.append(
        {
            "kind": "coverage",
            "severity": "positive" if missing_ever_count == 0 else "neutral",
            "text": coverage_text,
        }
    )
    return insights


def _load_tracked_git_paths(settings: Settings) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(settings.repo_root), "ls-files"],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _is_forbidden_env_path(path: str) -> bool:
    normalized = path.strip().lower()
    if normalized.endswith(".env.example"):
        return False
    return bool(ENV_TRACKED_PATTERN.search(normalized))


def _security_status_payload(
    *,
    date_utc: str,
    settings: Settings,
    last_local_run_id: str,
) -> dict[str, Any]:
    tracked = _load_tracked_git_paths(settings)
    tracked_lower = [item.lower() for item in tracked]

    no_raw_zones_tracked = not any(
        path.endswith(".zone")
        or path.endswith(".zone.gz")
        or path.endswith(".txt.gz")
        for path in tracked_lower
    )
    no_ai_dir_tracked = not any(path == ".ai" or path.startswith(".ai/") for path in tracked_lower)
    no_env_tracked = not any(_is_forbidden_env_path(path) for path in tracked_lower)

    return {
        "date_utc": date_utc,
        "checked_at_utc": utc_now_iso(),
        "no_raw_zones_tracked": bool(no_raw_zones_tracked),
        "no_ai_dir_tracked": bool(no_ai_dir_tracked),
        "no_env_tracked": bool(no_env_tracked),
        "last_local_run_id": str(last_local_run_id),
        "vercel_read_only": True,
    }


def _write_security_status(
    *,
    date_utc: str,
    settings: Settings,
    last_local_run_id: str,
) -> dict[str, Any]:
    payload = _security_status_payload(
        date_utc=date_utc,
        settings=settings,
        last_local_run_id=last_local_run_id,
    )
    dated_path = settings.signals_dir / f"{date_utc}_security_status.json"
    latest_path = settings.signals_dir / "security_status_latest.json"
    write_json(dated_path, payload)
    write_json(latest_path, payload)
    return {
        "payload": payload,
        "dated_path": dated_path,
        "latest_path": latest_path,
    }


def _rolling_rows_as_json(rolling_df: pd.DataFrame, limit: int = 20) -> list[dict[str, Any]]:
    subset = rolling_df.head(limit)
    return [
        {
            "tld": row["tld"],
            "count": None if pd.isna(row["count"]) else int(row["count"]),
            "prev_date_utc": "" if pd.isna(row["prev_date_utc"]) else str(row["prev_date_utc"]),
            "days_since_prev": None if pd.isna(row["days_since_prev"]) else int(row["days_since_prev"]),
            "delta_abs": None if pd.isna(row["delta_abs"]) else float(row["delta_abs"]),
            "delta_pct": None if pd.isna(row["delta_pct"]) else float(row["delta_pct"]),
            "cadence": "" if pd.isna(row.get("cadence")) else str(row.get("cadence")),
            "status": "" if pd.isna(row.get("status")) else str(row.get("status")),
            "is_first_seen": bool(pd.isna(row["prev_date_utc"]) or str(row["prev_date_utc"]).strip() == ""),
        }
        for _, row in subset.iterrows()
    ]


def _sector_snapshot_json(snapshot_df: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {
            "sector": row["sector"],
            "sector_count": int(row["sector_count"]),
            "sector_delta_pct": None if pd.isna(row["sector_delta_pct"]) else float(row["sector_delta_pct"]),
        }
        for _, row in snapshot_df.iterrows()
    ]


def _empty_signals_files(
    *,
    date_utc: str,
    top_movers_path: Path,
    core_top_movers_path: Path,
    rolling_updates_path: Path,
    volatility_path: Path,
    anomalies_path: Path,
    sector_snapshot_path: Path,
    sector_indices_path: Path,
) -> None:
    pd.DataFrame(columns=TOP_MOVERS_COLUMNS).to_csv(top_movers_path, index=False)
    pd.DataFrame(columns=TOP_MOVERS_COLUMNS).to_csv(core_top_movers_path, index=False)
    pd.DataFrame(columns=ROLLING_UPDATES_COLUMNS).to_csv(rolling_updates_path, index=False)
    pd.DataFrame(columns=VOLATILITY_COLUMNS).to_csv(volatility_path, index=False)
    pd.DataFrame(columns=ANOMALY_COLUMNS).to_csv(anomalies_path, index=False)
    pd.DataFrame(columns=SECTOR_COLUMNS).to_csv(sector_snapshot_path, index=False)
    if not sector_indices_path.exists():
        pd.DataFrame(columns=SECTOR_COLUMNS).to_csv(sector_indices_path, index=False)


def compute_signals_for_date(
    date_utc: str,
    *,
    run_id: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    _ensure_signal_dir(settings)

    coverage_meta = compute_coverage_latest(date_utc, settings=settings)
    coverage_payload = coverage_meta["coverage_payload"]
    approved_tlds_count = int(coverage_payload.get("approved_tlds_count", 0))
    missing_ever_count = int(coverage_payload.get("missing_ever_count", 0))
    resolved_run_id = run_id or str(uuid.uuid4())
    security_meta = _write_security_status(
        date_utc=date_utc,
        settings=settings,
        last_local_run_id=resolved_run_id,
    )

    daily_df = _load_daily_df(settings, date_utc)
    cross_meta = _write_cross_sectional_signals(
        date_utc=date_utc,
        day_df=daily_df,
        approved_tlds_count=approved_tlds_count,
        settings=settings,
    )

    breakdown = _counted_today_breakdown(settings, date_utc)
    counted_today_count = breakdown["counted_today_count"]
    counted_today_core_count = breakdown["counted_today_core_count"]
    counted_today_rolling_count = breakdown["counted_today_rolling_count"]
    snapshot_rows_today = breakdown["snapshot_rows_today"]
    total_delegated_domains_today = cross_meta["distribution_payload"]["total_delegated_counted_today"]

    coverage_pct_today = (
        float(counted_today_count) / float(approved_tlds_count)
        if approved_tlds_count
        else 0.0
    )
    note_if_partial = (
        "Snapshot rows are incomplete. See /approved for full list."
        if snapshot_rows_today != approved_tlds_count
        else ""
    )

    growth_df = _load_growth_df(settings)
    top_movers_path = settings.signals_dir / f"{date_utc}_top_movers.csv"
    core_top_movers_path = settings.signals_dir / f"{date_utc}_core_top_movers.csv"
    rolling_updates_path = settings.signals_dir / f"{date_utc}_rolling_updates.csv"
    volatility_path = settings.signals_dir / f"{date_utc}_volatility.csv"
    anomalies_path = settings.signals_dir / f"{date_utc}_anomalies.csv"
    sector_snapshot_path = settings.signals_dir / f"{date_utc}_sector_snapshot.csv"
    sector_indices_path = settings.signals_dir / "sector_indices.csv"

    if growth_df.empty:
        _empty_signals_files(
            date_utc=date_utc,
            top_movers_path=top_movers_path,
            core_top_movers_path=core_top_movers_path,
            rolling_updates_path=rolling_updates_path,
            volatility_path=volatility_path,
            anomalies_path=anomalies_path,
            sector_snapshot_path=sector_snapshot_path,
            sector_indices_path=sector_indices_path,
        )
        insights = _build_insights(
            approved_tlds_count=approved_tlds_count,
            counted_today_count=counted_today_count,
            snapshot_rows_today=snapshot_rows_today,
            missing_ever_count=missing_ever_count,
            distribution_payload=cross_meta["distribution_payload"],
            concentration_payload=cross_meta["concentration_payload"],
            approvals_diff_payload=cross_meta["approvals_diff_payload"],
            core_movers_df=pd.DataFrame(columns=TOP_MOVERS_COLUMNS),
        )
        latest_payload = {
            "date_utc": date_utc,
            "run_id": resolved_run_id,
            "approved_tlds_count": approved_tlds_count,
            "counted_today_count": counted_today_count,
            "counted_today_core_count": counted_today_core_count,
            "counted_today_rolling_count": counted_today_rolling_count,
            "snapshot_rows_today": snapshot_rows_today,
            "processed_tlds_count_today": snapshot_rows_today,
            "coverage_pct_today": coverage_pct_today,
            "note_if_partial": note_if_partial,
            "total_delegated_counted_today": total_delegated_domains_today,
            "total_delegated_domains_today": total_delegated_domains_today,
            "top_tlds": _top_tlds_as_json(cross_meta["top_tlds_df"], limit=10),
            "distribution": {
                "p50": int(cross_meta["distribution_payload"]["p50"]),
                "p90": int(cross_meta["distribution_payload"]["p90"]),
                "p99": int(cross_meta["distribution_payload"]["p99"]),
                "max": int(cross_meta["distribution_payload"]["max"]),
                "min": int(cross_meta["distribution_payload"]["min"]),
                "tiny_tlds_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
                "small_tlds_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
                "tiny_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
                "small_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
            },
            "concentration": {
                "top1_share_pct": float(cross_meta["concentration_payload"]["top1_share_pct"]),
                "top3_share_pct": float(cross_meta["concentration_payload"]["top3_share_pct"]),
                "top10_share_pct": float(cross_meta["concentration_payload"]["top10_share_pct"]),
                "hhi": float(cross_meta["concentration_payload"]["hhi"]),
            },
            "approvals_diff": {
                "prev_date_utc": cross_meta["approvals_diff_payload"].get("prev_date_utc", ""),
                "added_count": int(cross_meta["approvals_diff_payload"].get("added_count", 0)),
                "removed_count": int(cross_meta["approvals_diff_payload"].get("removed_count", 0)),
                "added_preview": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
                "added_first_10": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
            },
            "top_movers_abs": [],
            "top_movers_pct": [],
            "top_decliners_abs": [],
            "core_movers_abs": [],
            "core_movers_pct": [],
            "rolling_updates": [],
            "anomalies": [],
            "sector_snapshot": [],
            "insights": insights,
            "security_status": security_meta["payload"],
        }
        write_json(settings.latest_signals_path, latest_payload)
        return {
            "top_movers_path": top_movers_path,
            "core_top_movers_path": core_top_movers_path,
            "rolling_updates_path": rolling_updates_path,
            "volatility_path": volatility_path,
            "anomalies_path": anomalies_path,
            "sector_snapshot_path": sector_snapshot_path,
            "sector_indices_path": sector_indices_path,
            "latest_path": settings.latest_signals_path,
            "coverage_path": coverage_meta["coverage_path"],
            "top_tlds_path": cross_meta["top_tlds_path"],
            "top_tlds_latest_path": cross_meta["top_tlds_latest_path"],
            "distribution_path": cross_meta["distribution_path"],
            "distribution_latest_path": cross_meta["distribution_latest_path"],
            "concentration_path": cross_meta["concentration_path"],
            "concentration_latest_path": cross_meta["concentration_latest_path"],
            "approvals_diff_path": cross_meta["approvals_diff_path"],
            "approvals_diff_latest_path": cross_meta["approvals_diff_latest_path"],
            "security_status_path": security_meta["dated_path"],
            "security_status_latest_path": security_meta["latest_path"],
            "latest_payload": latest_payload,
        }

    growth_df = growth_df.sort_values(["tld", "date_utc"])
    growth_df["accel_abs_num"] = growth_df.groupby("tld")["delta_abs_num"].diff()
    growth_df["accel_pct_num"] = growth_df.groupby("tld")["delta_pct_num"].diff()
    day_df = growth_df[growth_df["date_utc"] == date_utc].copy()
    if day_df.empty:
        _empty_signals_files(
            date_utc=date_utc,
            top_movers_path=top_movers_path,
            core_top_movers_path=core_top_movers_path,
            rolling_updates_path=rolling_updates_path,
            volatility_path=volatility_path,
            anomalies_path=anomalies_path,
            sector_snapshot_path=sector_snapshot_path,
            sector_indices_path=sector_indices_path,
        )
        insights = _build_insights(
            approved_tlds_count=approved_tlds_count,
            counted_today_count=counted_today_count,
            snapshot_rows_today=snapshot_rows_today,
            missing_ever_count=missing_ever_count,
            distribution_payload=cross_meta["distribution_payload"],
            concentration_payload=cross_meta["concentration_payload"],
            approvals_diff_payload=cross_meta["approvals_diff_payload"],
            core_movers_df=pd.DataFrame(columns=TOP_MOVERS_COLUMNS),
        )
        latest_payload = {
            "date_utc": date_utc,
            "run_id": resolved_run_id,
            "approved_tlds_count": approved_tlds_count,
            "counted_today_count": counted_today_count,
            "counted_today_core_count": counted_today_core_count,
            "counted_today_rolling_count": counted_today_rolling_count,
            "snapshot_rows_today": snapshot_rows_today,
            "processed_tlds_count_today": snapshot_rows_today,
            "coverage_pct_today": coverage_pct_today,
            "note_if_partial": note_if_partial,
            "total_delegated_counted_today": total_delegated_domains_today,
            "total_delegated_domains_today": total_delegated_domains_today,
            "top_tlds": _top_tlds_as_json(cross_meta["top_tlds_df"], limit=10),
            "distribution": {
                "p50": int(cross_meta["distribution_payload"]["p50"]),
                "p90": int(cross_meta["distribution_payload"]["p90"]),
                "p99": int(cross_meta["distribution_payload"]["p99"]),
                "max": int(cross_meta["distribution_payload"]["max"]),
                "min": int(cross_meta["distribution_payload"]["min"]),
                "tiny_tlds_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
                "small_tlds_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
                "tiny_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
                "small_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
            },
            "concentration": {
                "top1_share_pct": float(cross_meta["concentration_payload"]["top1_share_pct"]),
                "top3_share_pct": float(cross_meta["concentration_payload"]["top3_share_pct"]),
                "top10_share_pct": float(cross_meta["concentration_payload"]["top10_share_pct"]),
                "hhi": float(cross_meta["concentration_payload"]["hhi"]),
            },
            "approvals_diff": {
                "prev_date_utc": cross_meta["approvals_diff_payload"].get("prev_date_utc", ""),
                "added_count": int(cross_meta["approvals_diff_payload"].get("added_count", 0)),
                "removed_count": int(cross_meta["approvals_diff_payload"].get("removed_count", 0)),
                "added_preview": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
                "added_first_10": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
            },
            "top_movers_abs": [],
            "top_movers_pct": [],
            "top_decliners_abs": [],
            "core_movers_abs": [],
            "core_movers_pct": [],
            "rolling_updates": [],
            "anomalies": [],
            "sector_snapshot": [],
            "insights": insights,
            "security_status": security_meta["payload"],
        }
        write_json(settings.latest_signals_path, latest_payload)
        return {
            "top_movers_path": top_movers_path,
            "core_top_movers_path": core_top_movers_path,
            "rolling_updates_path": rolling_updates_path,
            "volatility_path": volatility_path,
            "anomalies_path": anomalies_path,
            "sector_snapshot_path": sector_snapshot_path,
            "sector_indices_path": sector_indices_path,
            "latest_path": settings.latest_signals_path,
            "coverage_path": coverage_meta["coverage_path"],
            "top_tlds_path": cross_meta["top_tlds_path"],
            "top_tlds_latest_path": cross_meta["top_tlds_latest_path"],
            "distribution_path": cross_meta["distribution_path"],
            "distribution_latest_path": cross_meta["distribution_latest_path"],
            "concentration_path": cross_meta["concentration_path"],
            "concentration_latest_path": cross_meta["concentration_latest_path"],
            "approvals_diff_path": cross_meta["approvals_diff_path"],
            "approvals_diff_latest_path": cross_meta["approvals_diff_latest_path"],
            "security_status_path": security_meta["dated_path"],
            "security_status_latest_path": security_meta["latest_path"],
            "latest_payload": latest_payload,
        }

    day_df = _with_quality_flags(day_df)
    core_movers_df = _compute_core_top_movers(day_df, date_utc, settings)
    rolling_updates_df = _compute_rolling_updates(day_df, date_utc)
    vol_df = _compute_volatility(growth_df, day_df, date_utc)
    anomalies_df = _compute_anomalies(growth_df, day_df, date_utc)

    # Backward compatibility file, mirrors core movers.
    core_movers_df.to_csv(top_movers_path, index=False)
    core_movers_df.to_csv(core_top_movers_path, index=False)
    rolling_updates_df.to_csv(rolling_updates_path, index=False)
    vol_df.to_csv(volatility_path, index=False)
    anomalies_df.to_csv(anomalies_path, index=False)

    sector_rows = _compute_sector_rows(date_utc, day_df, settings)
    sector_all = _upsert_sector_indices(sector_rows, settings)
    sector_snapshot = sector_all[sector_all["date_utc"] == date_utc].copy()
    sector_snapshot.to_csv(sector_snapshot_path, index=False)
    insights = _build_insights(
        approved_tlds_count=approved_tlds_count,
        counted_today_count=counted_today_count,
        snapshot_rows_today=snapshot_rows_today,
        missing_ever_count=missing_ever_count,
        distribution_payload=cross_meta["distribution_payload"],
        concentration_payload=cross_meta["concentration_payload"],
        approvals_diff_payload=cross_meta["approvals_diff_payload"],
        core_movers_df=core_movers_df,
    )

    latest_payload = {
        "date_utc": date_utc,
        "run_id": resolved_run_id,
        "approved_tlds_count": approved_tlds_count,
        "counted_today_count": counted_today_count,
        "counted_today_core_count": counted_today_core_count,
        "counted_today_rolling_count": counted_today_rolling_count,
        "snapshot_rows_today": snapshot_rows_today,
        "processed_tlds_count_today": snapshot_rows_today,
        "coverage_pct_today": coverage_pct_today,
        "note_if_partial": note_if_partial,
        "total_delegated_counted_today": total_delegated_domains_today,
        "total_delegated_domains_today": total_delegated_domains_today,
        "top_tlds": _top_tlds_as_json(cross_meta["top_tlds_df"], limit=10),
        "distribution": {
            "p50": int(cross_meta["distribution_payload"]["p50"]),
            "p90": int(cross_meta["distribution_payload"]["p90"]),
            "p99": int(cross_meta["distribution_payload"]["p99"]),
            "max": int(cross_meta["distribution_payload"]["max"]),
            "min": int(cross_meta["distribution_payload"]["min"]),
            "tiny_tlds_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
            "small_tlds_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
            "tiny_lt_100": int(cross_meta["distribution_payload"]["tiny_tlds_lt_100"]),
            "small_lt_1000": int(cross_meta["distribution_payload"]["small_tlds_lt_1000"]),
        },
        "concentration": {
            "top1_share_pct": float(cross_meta["concentration_payload"]["top1_share_pct"]),
            "top3_share_pct": float(cross_meta["concentration_payload"]["top3_share_pct"]),
            "top10_share_pct": float(cross_meta["concentration_payload"]["top10_share_pct"]),
            "hhi": float(cross_meta["concentration_payload"]["hhi"]),
        },
        "approvals_diff": {
            "prev_date_utc": cross_meta["approvals_diff_payload"].get("prev_date_utc", ""),
            "added_count": int(cross_meta["approvals_diff_payload"].get("added_count", 0)),
            "removed_count": int(cross_meta["approvals_diff_payload"].get("removed_count", 0)),
            "added_preview": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
            "added_first_10": list(cross_meta["approvals_diff_payload"].get("added", []))[:10],
        },
        "top_movers_abs": _top_rows_as_json(core_movers_df, "top_abs_growers"),
        "top_movers_pct": _top_rows_as_json(core_movers_df, "top_pct_growers"),
        "top_decliners_abs": _top_rows_as_json(core_movers_df, "top_abs_decliners"),
        "core_movers_abs": _top_rows_as_json(core_movers_df, "top_abs_growers"),
        "core_movers_pct": _top_rows_as_json(core_movers_df, "top_pct_growers"),
        "rolling_updates": _rolling_rows_as_json(rolling_updates_df, limit=20),
        "anomalies": [
            {
                "tld": row["tld"],
                "reason": row["reason"],
                "delta_pct": None if pd.isna(row["delta_pct"]) else float(row["delta_pct"]),
                "z": None if pd.isna(row["z"]) else float(row["z"]),
                "robust_z": None if pd.isna(row["robust_z"]) else float(row["robust_z"]),
            }
            for _, row in anomalies_df.iterrows()
        ],
        "sector_snapshot": _sector_snapshot_json(sector_snapshot),
        "insights": insights,
        "security_status": security_meta["payload"],
    }
    write_json(settings.latest_signals_path, latest_payload)

    return {
        "top_movers_path": top_movers_path,
        "core_top_movers_path": core_top_movers_path,
        "rolling_updates_path": rolling_updates_path,
        "volatility_path": volatility_path,
        "anomalies_path": anomalies_path,
        "sector_snapshot_path": sector_snapshot_path,
        "sector_indices_path": sector_indices_path,
        "latest_path": settings.latest_signals_path,
        "coverage_path": coverage_meta["coverage_path"],
        "top_tlds_path": cross_meta["top_tlds_path"],
        "top_tlds_latest_path": cross_meta["top_tlds_latest_path"],
        "distribution_path": cross_meta["distribution_path"],
        "distribution_latest_path": cross_meta["distribution_latest_path"],
        "concentration_path": cross_meta["concentration_path"],
        "concentration_latest_path": cross_meta["concentration_latest_path"],
        "approvals_diff_path": cross_meta["approvals_diff_path"],
        "approvals_diff_latest_path": cross_meta["approvals_diff_latest_path"],
        "security_status_path": security_meta["dated_path"],
        "security_status_latest_path": security_meta["latest_path"],
        "latest_payload": latest_payload,
    }
