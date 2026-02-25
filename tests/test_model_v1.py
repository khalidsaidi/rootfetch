from __future__ import annotations

import json
import csv
import subprocess
import sys
from pathlib import Path

import pandas as pd

from rootfetch.signals.model_v1 import compute_model_v1_from_growth
from rootfetch.signals.compute import compute_signals_for_date


def _growth_from_history(history: list[tuple[str, dict[str, float]]]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    previous: dict[str, float] = {}
    for date_utc, counts in history:
        for tld, count in counts.items():
            prev_count = previous.get(tld, count)
            delta_abs = count - prev_count
            delta_pct = (delta_abs / prev_count) if prev_count > 0 else 0.0
            rows.append(
                {
                    "date_utc": date_utc,
                    "tld": tld,
                    "status": "ok",
                    "count_num": float(count),
                    "delta_abs_num": float(delta_abs),
                    "delta_pct_num": float(delta_pct),
                }
            )
        previous = dict(counts)
    return pd.DataFrame(rows)


def _growth_from_snapshot_history(payload: dict) -> tuple[pd.DataFrame, str, int]:
    rows: list[dict[str, object]] = []
    snapshots = payload["history"]
    target_date = snapshots[-1]["date_utc"]
    approved = int(snapshots[-1].get("approved_tlds_count") or 0)
    for snapshot in snapshots:
        date_utc = snapshot["date_utc"]
        for row in snapshot.get("rows", []):
            count = float(row["count"])
            prev_count = float(row.get("prev_count", count))
            delta_abs = count - prev_count
            delta_pct = (delta_abs / prev_count) if prev_count > 0 else 0.0
            rows.append(
                {
                    "date_utc": date_utc,
                    "tld": str(row["tld"]),
                    "status": "ok",
                    "count_num": count,
                    "delta_abs_num": delta_abs,
                    "delta_pct_num": delta_pct,
                }
            )
    return pd.DataFrame(rows), target_date, approved


def test_model_v1_is_deterministic() -> None:
    growth = _growth_from_history(
        [
            ("2026-02-21", {"a": 100, "b": 90, "c": 80, "d": 70}),
            ("2026-02-22", {"a": 101, "b": 90, "c": 80, "d": 70}),
            ("2026-02-23", {"a": 102, "b": 90, "c": 80, "d": 70}),
            ("2026-02-24", {"a": 104, "b": 89, "c": 80, "d": 70}),
            ("2026-02-25", {"a": 106, "b": 88, "c": 80, "d": 70}),
        ]
    )
    first = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-25", approved_tlds_count=4)
    second = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-25", approved_tlds_count=4)
    assert first == second


def test_model_v1_zero_delta_is_stable() -> None:
    growth = _growth_from_history(
        [
            ("2026-02-21", {"a": 100, "b": 90, "c": 80, "d": 70}),
            ("2026-02-22", {"a": 100, "b": 90, "c": 80, "d": 70}),
            ("2026-02-23", {"a": 100, "b": 90, "c": 80, "d": 70}),
            ("2026-02-24", {"a": 100, "b": 90, "c": 80, "d": 70}),
        ]
    )
    model = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-24", approved_tlds_count=4)
    assert model["dvi"] == 0.0
    assert model["regime"] == "STABLE"


def test_model_v1_hysteresis_requires_two_snapshots() -> None:
    growth = _growth_from_history(
        [
            (
                "2026-02-21",
                {
                    "t1": 100, "t2": 100, "t3": 100, "t4": 100, "t5": 100, "t6": 100,
                    "t7": 100, "t8": 100, "t9": 100, "t10": 100, "t11": 100, "t12": 100,
                },
            ),
            (
                "2026-02-22",
                {
                    "t1": 100, "t2": 100, "t3": 100, "t4": 100, "t5": 100, "t6": 100,
                    "t7": 100, "t8": 100, "t9": 100, "t10": 100, "t11": 100, "t12": 100,
                },
            ),
            (
                "2026-02-23",
                {
                    "t1": 100, "t2": 100, "t3": 100, "t4": 100, "t5": 100, "t6": 100,
                    "t7": 100, "t8": 100, "t9": 100, "t10": 100, "t11": 100, "t12": 100,
                },
            ),
            (
                "2026-02-24",
                {
                    "t1": 130, "t2": 125, "t3": 120, "t4": 100, "t5": 100, "t6": 100,
                    "t7": 100, "t8": 100, "t9": 100, "t10": 100, "t11": 70, "t12": 65,
                },
            ),
            (
                "2026-02-25",
                {
                    "t1": 150, "t2": 140, "t3": 130, "t4": 100, "t5": 100, "t6": 100,
                    "t7": 100, "t8": 100, "t9": 100, "t10": 100, "t11": 55, "t12": 50,
                },
            ),
        ]
    )
    before_confirm = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-24", approved_tlds_count=12)
    after_confirm = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-25", approved_tlds_count=12)

    assert before_confirm["regime"] != "CONSOLIDATING"
    assert after_confirm["regime"] == "CONSOLIDATING"


def test_model_v1_extreme_anomaly_spike_increases_dvi() -> None:
    growth = _growth_from_history(
        [
            ("2026-02-21", {"a": 100, "b": 100, "c": 100, "d": 100}),
            ("2026-02-22", {"a": 100, "b": 100, "c": 100, "d": 100}),
            ("2026-02-23", {"a": 100, "b": 100, "c": 100, "d": 100}),
            ("2026-02-24", {"a": 160, "b": 40, "c": 100, "d": 100}),
        ]
    )
    previous = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-23", approved_tlds_count=4)
    current = compute_model_v1_from_growth(growth_df=growth, date_utc="2026-02-24", approved_tlds_count=4)

    assert current["dvi"] > previous["dvi"]
    assert current["dvi_components"]["dispersion_norm"] > 0.0


def test_model_v1_regression_fixture_matches_expected() -> None:
    fixture_path = Path(__file__).parent / "fixtures" / "model_v1_baseline_snapshot.json"
    expected_path = Path(__file__).parent / "fixtures" / "model_v1_expected.json"

    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    growth, target_date, approved = _growth_from_snapshot_history(payload)
    result = compute_model_v1_from_growth(growth_df=growth, date_utc=target_date, approved_tlds_count=approved)
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    assert result == expected


def test_compute_model_v1_script_matches_library() -> None:
    fixture_path = Path(__file__).parent / "fixtures" / "model_v1_baseline_snapshot.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    growth, target_date, approved = _growth_from_snapshot_history(payload)
    expected = compute_model_v1_from_growth(growth_df=growth, date_utc=target_date, approved_tlds_count=approved)

    proc = subprocess.run(
        [sys.executable, "compute_model_v1.py", str(fixture_path)],
        check=True,
        text=True,
        capture_output=True,
    )
    from_script = json.loads(proc.stdout)
    assert from_script == expected


def test_compute_signals_includes_model_contract_fields(temp_settings) -> None:
    date_utc = "2026-02-25"
    temp_settings.approved_dir.mkdir(parents=True, exist_ok=True)
    (temp_settings.approved_dir / "latest.json").write_text(
        json.dumps(
            {
                "date_utc": date_utc,
                "count": 3,
                "tlds": ["alpha", "beta", "gamma"],
            }
        ),
        encoding="utf-8",
    )

    daily_path = temp_settings.daily_counts_dir / f"{date_utc}.csv"
    with daily_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
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
        )
        writer.writerow([date_utc, "alpha", "100", "false", "czds_zone", f"{date_utc}T00:00:00+00:00", "", "ns_sld_exact", "0", "0", "0", "1", "0.1", "ok", "", "core"])
        writer.writerow([date_utc, "beta", "90", "false", "czds_zone", f"{date_utc}T00:00:00+00:00", "", "ns_sld_exact", "0", "0", "0", "1", "0.1", "ok", "", "rolling"])
        writer.writerow([date_utc, "gamma", "80", "false", "czds_zone", f"{date_utc}T00:00:00+00:00", "", "ns_sld_exact", "0", "0", "0", "1", "0.1", "ok", "", "baseline"])

    with temp_settings.growth_trends_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
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
        writer.writerow(["2026-02-24", "alpha", "98", "0", "0", "false", "true", "r1", "2026-02-24T00:00:00+00:00", "ns_sld_exact", "ok", "", "", "core"])
        writer.writerow(["2026-02-24", "beta", "91", "0", "0", "false", "true", "r1", "2026-02-24T00:00:00+00:00", "ns_sld_exact", "ok", "", "", "rolling"])
        writer.writerow(["2026-02-24", "gamma", "80", "0", "0", "false", "true", "r1", "2026-02-24T00:00:00+00:00", "ns_sld_exact", "ok", "", "", "baseline"])
        writer.writerow([date_utc, "alpha", "100", "2", "0.0204", "false", "false", "r2", f"{date_utc}T00:00:00+00:00", "ns_sld_exact", "ok", "2026-02-24", "1", "core"])
        writer.writerow([date_utc, "beta", "90", "-1", "-0.0110", "false", "false", "r2", f"{date_utc}T00:00:00+00:00", "ns_sld_exact", "ok", "2026-02-24", "1", "rolling"])
        writer.writerow([date_utc, "gamma", "80", "0", "0", "false", "false", "r2", f"{date_utc}T00:00:00+00:00", "ns_sld_exact", "ok", "2026-02-24", "1", "baseline"])

    compute_signals_for_date(date_utc, settings=temp_settings, run_id="model-test")
    payload = json.loads(temp_settings.latest_signals_path.read_text(encoding="utf-8"))

    required = [
        "model_version",
        "methodology_version",
        "dvi",
        "dvi_components",
        "regime",
        "regime_confidence",
        "regime_inputs",
        "regime_base",
        "regime_candidate",
        "regime_duration_snapshots",
        "model_calibration",
    ]
    for key in required:
        assert key in payload
    assert payload["model_version"] == "rootfetch_model_v1"
