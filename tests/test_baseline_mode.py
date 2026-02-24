from __future__ import annotations

import csv
import json

import pytest

from rootfetch.core.pipeline import baseline_completion_status, run_baseline, run_hybrid


def _write_approved_latest(temp_settings, *, date_utc: str, tlds: list[str]) -> None:
    temp_settings.approved_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "date_utc": date_utc,
        "fetched_at_utc": f"{date_utc}T00:00:00+00:00",
        "count": len(tlds),
        "tlds": tlds,
    }
    (temp_settings.approved_dir / "latest.json").write_text(json.dumps(payload), encoding="utf-8")


def test_run_baseline_dry_run_summary(temp_settings) -> None:
    _write_approved_latest(temp_settings, date_utc="2026-02-24", tlds=["app", "dev", "xyz"])
    daily_path = temp_settings.daily_counts_dir / "2026-02-24.csv"
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
        writer.writerow(
            [
                "2026-02-24",
                "app",
                "10",
                "false",
                "czds_zone",
                "2026-02-24T00:00:00+00:00",
                "",
                "ns_sld_exact",
                "0",
                "0",
                "0",
                "1",
                "0.1",
                "ok",
                "",
                "",
            ]
        )

    result = run_baseline(date_utc="2026-02-24", dry_run=True, resume=True, settings=temp_settings)
    assert result.summary["mode"] == "baseline"
    assert result.summary["approved_count"] == 3
    assert result.summary["already_ok_count"] == 1
    assert result.summary["baseline_target_count"] == 2
    assert set(result.selected_tlds) == {"dev", "xyz"}


def test_baseline_status_uses_daily_counts_union(temp_settings) -> None:
    _write_approved_latest(temp_settings, date_utc="2026-02-24", tlds=["app", "dev"])
    daily_path = temp_settings.daily_counts_dir / "2026-02-24.csv"
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
        writer.writerow(
            [
                "2026-02-24",
                "app",
                "10",
                "false",
                "czds_zone",
                "2026-02-24T00:00:00+00:00",
                "",
                "ns_sld_exact",
                "0",
                "0",
                "0",
                "1",
                "0.1",
                "ok",
                "",
                "baseline",
            ]
        )
        writer.writerow(
            [
                "2026-02-24",
                "dev",
                "20",
                "false",
                "czds_zone",
                "2026-02-24T00:00:00+00:00",
                "",
                "ns_sld_exact",
                "0",
                "0",
                "0",
                "1",
                "0.1",
                "ok",
                "",
                "baseline",
            ]
        )

    temp_settings.baseline_complete_path.parent.mkdir(parents=True, exist_ok=True)
    temp_settings.baseline_complete_path.write_text(
        json.dumps(
            {
                "completed_at_utc": "2026-02-24T00:00:00+00:00",
                "baseline_date_utc": "2026-02-24",
                "approved_count_at_completion": 2,
            }
        ),
        encoding="utf-8",
    )

    status = baseline_completion_status(date_utc="2026-02-24", settings=temp_settings)
    assert status["approved_tlds_count"] == 2
    assert status["counted_ever_count"] == 2
    assert status["missing_ever_count"] == 0
    assert status["baseline_complete"] is True


def test_run_hybrid_requires_baseline_completion(temp_settings) -> None:
    with pytest.raises(RuntimeError):
        run_hybrid(date_utc="2026-02-24", dry_run=False, settings=temp_settings)


def test_run_baseline_writes_completion_marker(temp_settings, monkeypatch) -> None:
    links = [
        {"tld": "app", "url": "https://example.test/app.zone.gz"},
        {"tld": "dev", "url": "https://example.test/dev.zone.gz"},
    ]

    monkeypatch.setattr("rootfetch.core.pipeline.get_access_token", lambda **_: "token")
    monkeypatch.setattr("rootfetch.core.pipeline.fetch_approved_links", lambda *_args, **_kwargs: links)

    def _fake_download(url: str, tld: str, token: str, settings) -> dict[str, object]:
        assert url
        assert token == "token"
        return {
            "tld": tld,
            "count_ns_sld": 100 if tld == "app" else 200,
            "count_ds_sld": 0,
            "count_glue_hosts": 0,
            "count_ns_rr": 0,
            "is_estimate": False,
            "count_mode": settings.count_mode,
            "bytes_downloaded": 10,
            "fetch_seconds": 0.1,
            "fetched_at_utc": "2026-02-24T00:00:00+00:00",
            "status": "ok",
            "error": "",
        }

    monkeypatch.setattr("rootfetch.core.pipeline._download_and_count", _fake_download)

    result = run_baseline(date_utc="2026-02-24", dry_run=False, settings=temp_settings)

    assert result.summary["baseline_complete"] is True
    assert temp_settings.baseline_complete_path.exists()

    coverage_payload = json.loads((temp_settings.signals_dir / "coverage_latest.json").read_text(encoding="utf-8"))
    assert coverage_payload["approved_tlds_count"] == 2
    assert coverage_payload["counted_ever_count"] == 2
    assert coverage_payload["missing_ever_count"] == 0

    rows = list(csv.DictReader((temp_settings.daily_counts_dir / "2026-02-24.csv").open("r", newline="", encoding="utf-8")))
    assert rows
    assert {row["cadence"] for row in rows} == {"baseline"}
