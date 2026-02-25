from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import pandas as pd

MODEL_VERSION = "rootfetch_model_v1"
METHODOLOGY_VERSION = "2026-03-01"

ANOMALY_Z_THRESHOLD = 2.5
CALIBRATION_WINDOW_DATES = 180

# Floors avoid over-amplifying scores when history is short.
DISPERSION_SCALE_FLOOR = 3.0
CONCENTRATION_SCALE_FLOOR = 0.005
ANOMALY_SCALE_FLOOR = 0.20

TOP10_SHARE_DELTA_THRESHOLD = 0.001
HYSTERESIS_REQUIRED_SNAPSHOTS = 2
MIN_REGIME_DURATION_SNAPSHOTS = 3

DVI_DISPERSION_WEIGHT = 0.5
DVI_CONCENTRATION_WEIGHT = 0.3
DVI_ANOMALY_WEIGHT = 0.2

REGIME_DVI_WEIGHT = 0.5
REGIME_HHI_WEIGHT = 0.3
REGIME_TOP10_WEIGHT = 0.2


def _parse_date(value: str) -> datetime | None:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d")
    except Exception:
        return None


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except Exception:
        return default
    return out if math.isfinite(out) else default


def _quantile99(values: list[float]) -> float:
    cleaned = [value for value in values if math.isfinite(value)]
    if not cleaned:
        return 0.0
    return float(pd.Series(cleaned).quantile(0.99, interpolation="linear"))


def _normalize(raw: float, scale: float) -> float:
    if not math.isfinite(raw) or raw <= 0.0:
        return 0.0
    if not math.isfinite(scale) or scale <= 0.0:
        return 0.0
    return min(raw / scale, 1.0)


def _dvi_band(score: float) -> str:
    if score < 25.0:
        return "stable"
    if score < 50.0:
        return "elevated"
    if score < 75.0:
        return "active"
    return "turbulent"


def _base_regime_for_dvi(score: float) -> str:
    band = _dvi_band(score)
    if band == "stable":
        return "STABLE"
    if band == "elevated":
        return "ELEVATED"
    if band == "active":
        return "ACTIVE"
    return "TURBULENT"


def _direction_score(value: float, threshold: float, expected_direction: float) -> float:
    if not math.isfinite(value):
        return 0.5
    if abs(value) <= threshold:
        return 0.5
    if value * expected_direction > 0:
        return 1.0
    return 0.0


def _regime_confidence(
    *,
    regime: str,
    base_regime: str,
    dvi_score: float,
    delta_hhi: float,
    top10_share_delta: float,
) -> float:
    if regime == "CONSOLIDATING":
        dvi_match = 1.0 if dvi_score < 50.0 else 0.0
        hhi_match = _direction_score(delta_hhi, 0.0, 1.0)
        top10_match = _direction_score(top10_share_delta, TOP10_SHARE_DELTA_THRESHOLD, 1.0)
    elif regime == "FRAGMENTING":
        dvi_match = 1.0 if dvi_score < 50.0 else 0.0
        hhi_match = _direction_score(delta_hhi, 0.0, -1.0)
        top10_match = _direction_score(top10_share_delta, TOP10_SHARE_DELTA_THRESHOLD, -1.0)
    else:
        dvi_match = 1.0 if regime == base_regime else 0.0
        hhi_match = 1.0 if abs(delta_hhi) <= 1e-12 else 0.6
        top10_match = 1.0 if abs(top10_share_delta) <= TOP10_SHARE_DELTA_THRESHOLD else 0.6

    score = (
        REGIME_DVI_WEIGHT * dvi_match
        + REGIME_HHI_WEIGHT * hhi_match
        + REGIME_TOP10_WEIGHT * top10_match
    )
    return round(min(max(score, 0.0), 1.0), 2)


def _default_model_payload(date_utc: str, approved_tlds_count: int | None = None) -> dict[str, Any]:
    approved = int(approved_tlds_count or 0)
    return {
        "model_version": MODEL_VERSION,
        "methodology_version": METHODOLOGY_VERSION,
        "date_utc": date_utc,
        "effective_date_utc": date_utc,
        "dvi": 0.0,
        "dvi_band": "stable",
        "dvi_components": {
            "dispersion_norm": 0.0,
            "concentration_norm": 0.0,
            "anomaly_norm": 0.0,
        },
        "dvi_inputs": {
            "dispersion_raw": 0.0,
            "concentration_shift_raw": 0.0,
            "anomaly_prop_raw": 0.0,
            "approved_tlds_count": approved,
        },
        "regime": "STABLE",
        "regime_base": "STABLE",
        "regime_candidate": "STABLE",
        "regime_confidence": 0.8,
        "regime_duration_snapshots": 1,
        "regime_inputs": {
            "delta_hhi": 0.0,
            "top10_share_delta": 0.0,
            "median_delta": 0.0,
        },
        "calibration": {
            "window_dates": CALIBRATION_WINDOW_DATES,
            "dispersion_p99": DISPERSION_SCALE_FLOOR,
            "concentration_p99": CONCENTRATION_SCALE_FLOOR,
            "anomaly_p99": ANOMALY_SCALE_FLOOR,
            "anomaly_z_threshold": ANOMALY_Z_THRESHOLD,
            "weights": {
                "dispersion": DVI_DISPERSION_WEIGHT,
                "concentration": DVI_CONCENTRATION_WEIGHT,
                "anomaly": DVI_ANOMALY_WEIGHT,
            },
            "top10_share_delta_threshold": TOP10_SHARE_DELTA_THRESHOLD,
            "hysteresis_snapshots": HYSTERESIS_REQUIRED_SNAPSHOTS,
            "min_regime_duration_snapshots": MIN_REGIME_DURATION_SNAPSHOTS,
        },
    }


def _ensure_growth_columns(growth_df: pd.DataFrame) -> pd.DataFrame:
    if growth_df.empty:
        return pd.DataFrame(
            columns=[
                "date_utc",
                "tld",
                "status",
                "count_num",
                "delta_abs_num",
                "delta_pct_num",
            ]
        )

    out = growth_df.copy()
    if "count_num" not in out.columns:
        out["count_num"] = pd.to_numeric(out.get("count"), errors="coerce")
    if "delta_abs_num" not in out.columns:
        out["delta_abs_num"] = pd.to_numeric(out.get("delta_abs"), errors="coerce")
    if "delta_pct_num" not in out.columns:
        out["delta_pct_num"] = pd.to_numeric(out.get("delta_pct"), errors="coerce")
    if "status" not in out.columns:
        out["status"] = "ok"
    if "date_utc" not in out.columns:
        out["date_utc"] = ""
    if "tld" not in out.columns:
        out["tld"] = ""
    out["date_utc"] = out["date_utc"].astype(str)
    out["tld"] = out["tld"].astype(str)
    out["status"] = out["status"].astype(str).str.strip().str.lower()
    return out


def compute_model_v1_from_growth(
    *,
    growth_df: pd.DataFrame,
    date_utc: str,
    approved_tlds_count: int | None = None,
) -> dict[str, Any]:
    working = _ensure_growth_columns(growth_df)
    if working.empty:
        return _default_model_payload(date_utc, approved_tlds_count)

    target_date = _parse_date(date_utc)
    if target_date is None:
        return _default_model_payload(date_utc, approved_tlds_count)

    ok_rows = working[
        (working["status"] == "ok")
        & (working["count_num"].notna())
    ].copy()
    if ok_rows.empty:
        return _default_model_payload(date_utc, approved_tlds_count)

    parsed_dates = ok_rows["date_utc"].map(_parse_date)
    ok_rows = ok_rows[parsed_dates.notna()].copy()
    ok_rows["parsed_date"] = parsed_dates[parsed_dates.notna()]
    ok_rows = ok_rows[ok_rows["parsed_date"] <= target_date]
    if ok_rows.empty:
        return _default_model_payload(date_utc, approved_tlds_count)

    unique_dates = (
        ok_rows[["date_utc", "parsed_date"]]
        .drop_duplicates()
        .sort_values("parsed_date")
    )
    ordered_dates = [str(item) for item in unique_dates["date_utc"].tolist()]
    effective_date_utc = date_utc if date_utc in ordered_dates else ordered_dates[-1]

    per_day: list[dict[str, Any]] = []
    approved_denominator = int(approved_tlds_count or 0)

    for day in ordered_dates:
        day_rows = ok_rows[ok_rows["date_utc"] == day].copy()
        counts = day_rows["count_num"].astype(float)
        total = float(counts.sum()) if not counts.empty else 0.0
        if total > 0:
            shares = counts / total
            hhi = float((shares.pow(2)).sum())
            top10_share = float(shares.sort_values(ascending=False).head(10).sum())
        else:
            hhi = 0.0
            top10_share = 0.0

        deltas = day_rows["delta_abs_num"].astype(float).dropna()
        if len(deltas.index) >= 2:
            mean_delta = float(deltas.mean())
            std_delta = float(deltas.std(ddof=0))
            if std_delta > 0:
                z_scores = (deltas - mean_delta) / std_delta
                dispersion_raw = float(z_scores.abs().mean())
                denominator = approved_denominator if approved_denominator > 0 else len(day_rows.index)
                anomaly_prop = (
                    float((z_scores.abs() > ANOMALY_Z_THRESHOLD).sum()) / float(denominator)
                    if denominator > 0
                    else 0.0
                )
            else:
                dispersion_raw = 0.0
                anomaly_prop = 0.0
        else:
            dispersion_raw = 0.0
            anomaly_prop = 0.0

        delta_pct = day_rows["delta_pct_num"].astype(float).dropna()
        median_delta = float(delta_pct.median()) if len(delta_pct.index) > 0 else 0.0

        per_day.append(
            {
                "date_utc": day,
                "hhi": hhi,
                "top10_share": top10_share,
                "dispersion_raw": dispersion_raw,
                "anomaly_prop_raw": anomaly_prop,
                "median_delta": median_delta,
            }
        )

    if not per_day:
        return _default_model_payload(date_utc, approved_tlds_count)

    for idx, item in enumerate(per_day):
        prev = per_day[idx - 1] if idx > 0 else None
        delta_hhi = item["hhi"] - prev["hhi"] if prev is not None else 0.0
        top10_delta = item["top10_share"] - prev["top10_share"] if prev is not None else 0.0
        item["concentration_shift_raw"] = abs(delta_hhi)
        item["delta_hhi"] = delta_hhi
        item["top10_share_delta"] = top10_delta

        win_start = max(0, idx - CALIBRATION_WINDOW_DATES + 1)
        window = per_day[win_start : idx + 1]
        d_scale = max(
            _quantile99([_to_float(row["dispersion_raw"]) for row in window]),
            DISPERSION_SCALE_FLOOR,
        )
        c_scale = max(
            _quantile99([_to_float(row["concentration_shift_raw"]) for row in window]),
            CONCENTRATION_SCALE_FLOOR,
        )
        a_scale = max(
            _quantile99([_to_float(row["anomaly_prop_raw"]) for row in window]),
            ANOMALY_SCALE_FLOOR,
        )

        dispersion_norm = _normalize(_to_float(item["dispersion_raw"]), d_scale)
        concentration_norm = _normalize(_to_float(item["concentration_shift_raw"]), c_scale)
        anomaly_norm = _normalize(_to_float(item["anomaly_prop_raw"]), a_scale)
        dvi_raw = (
            DVI_DISPERSION_WEIGHT * dispersion_norm
            + DVI_CONCENTRATION_WEIGHT * concentration_norm
            + DVI_ANOMALY_WEIGHT * anomaly_norm
        )
        dvi_score = round(100.0 * dvi_raw, 1)

        base_regime = _base_regime_for_dvi(dvi_score)
        if (
            dvi_score < 50.0
            and delta_hhi > 0.0
            and top10_delta > TOP10_SHARE_DELTA_THRESHOLD
        ):
            candidate_regime = "CONSOLIDATING"
        elif (
            dvi_score < 50.0
            and delta_hhi < 0.0
            and top10_delta < -TOP10_SHARE_DELTA_THRESHOLD
        ):
            candidate_regime = "FRAGMENTING"
        else:
            candidate_regime = base_regime

        item["dvi"] = dvi_score
        item["dvi_band"] = _dvi_band(dvi_score)
        item["dvi_components"] = {
            "dispersion_norm": round(dispersion_norm, 6),
            "concentration_norm": round(concentration_norm, 6),
            "anomaly_norm": round(anomaly_norm, 6),
        }
        item["base_regime"] = base_regime
        item["candidate_regime"] = candidate_regime
        item["calibration"] = {
            "dispersion_p99": round(d_scale, 6),
            "concentration_p99": round(c_scale, 6),
            "anomaly_p99": round(a_scale, 6),
        }

    active_regime = per_day[0]["candidate_regime"]
    regime_duration = 1
    pending_regime: str | None = None
    pending_streak = 0

    for idx, item in enumerate(per_day):
        if idx == 0:
            item["regime"] = active_regime
            item["regime_duration_snapshots"] = regime_duration
            continue

        candidate = item["candidate_regime"]
        if candidate == active_regime:
            regime_duration += 1
            pending_regime = None
            pending_streak = 0
        else:
            if regime_duration < MIN_REGIME_DURATION_SNAPSHOTS:
                regime_duration += 1
                pending_regime = None
                pending_streak = 0
            else:
                if pending_regime == candidate:
                    pending_streak += 1
                else:
                    pending_regime = candidate
                    pending_streak = 1
                if pending_streak >= HYSTERESIS_REQUIRED_SNAPSHOTS:
                    active_regime = candidate
                    regime_duration = 1
                    pending_regime = None
                    pending_streak = 0
                else:
                    regime_duration += 1

        item["regime"] = active_regime
        item["regime_duration_snapshots"] = regime_duration

    for item in per_day:
        item["regime_confidence"] = _regime_confidence(
            regime=str(item["regime"]),
            base_regime=str(item["base_regime"]),
            dvi_score=_to_float(item["dvi"]),
            delta_hhi=_to_float(item["delta_hhi"]),
            top10_share_delta=_to_float(item["top10_share_delta"]),
        )

    current = next((row for row in per_day if row["date_utc"] == effective_date_utc), per_day[-1])
    approved_for_output = approved_denominator if approved_denominator > 0 else len(
        ok_rows[ok_rows["date_utc"] == effective_date_utc]["tld"].dropna().unique().tolist()
    )

    return {
        "model_version": MODEL_VERSION,
        "methodology_version": METHODOLOGY_VERSION,
        "date_utc": date_utc,
        "effective_date_utc": effective_date_utc,
        "dvi": _to_float(current["dvi"]),
        "dvi_band": str(current["dvi_band"]),
        "dvi_components": dict(current["dvi_components"]),
        "dvi_inputs": {
            "dispersion_raw": round(_to_float(current["dispersion_raw"]), 6),
            "concentration_shift_raw": round(_to_float(current["concentration_shift_raw"]), 6),
            "anomaly_prop_raw": round(_to_float(current["anomaly_prop_raw"]), 6),
            "approved_tlds_count": int(approved_for_output),
        },
        "regime": str(current["regime"]),
        "regime_base": str(current["base_regime"]),
        "regime_candidate": str(current["candidate_regime"]),
        "regime_confidence": _to_float(current["regime_confidence"]),
        "regime_duration_snapshots": int(current["regime_duration_snapshots"]),
        "regime_inputs": {
            "delta_hhi": round(_to_float(current["delta_hhi"]), 6),
            "top10_share_delta": round(_to_float(current["top10_share_delta"]), 6),
            "median_delta": round(_to_float(current["median_delta"]), 6),
        },
        "calibration": {
            "window_dates": CALIBRATION_WINDOW_DATES,
            "dispersion_p99": round(_to_float(current["calibration"]["dispersion_p99"]), 6),
            "concentration_p99": round(_to_float(current["calibration"]["concentration_p99"]), 6),
            "anomaly_p99": round(_to_float(current["calibration"]["anomaly_p99"]), 6),
            "anomaly_z_threshold": ANOMALY_Z_THRESHOLD,
            "weights": {
                "dispersion": DVI_DISPERSION_WEIGHT,
                "concentration": DVI_CONCENTRATION_WEIGHT,
                "anomaly": DVI_ANOMALY_WEIGHT,
            },
            "top10_share_delta_threshold": TOP10_SHARE_DELTA_THRESHOLD,
            "hysteresis_snapshots": HYSTERESIS_REQUIRED_SNAPSHOTS,
            "min_regime_duration_snapshots": MIN_REGIME_DURATION_SNAPSHOTS,
        },
    }
