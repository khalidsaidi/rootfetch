from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from rootfetch.publish import PublishInputs, prepare_latest_publish_bundle, publish_run


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _build_source_bundle(base: Path, *, coverage_seed: int = 1) -> Path:
    source = base / "source"
    source.mkdir(parents=True, exist_ok=True)
    _write_json(
        source / "coverage_latest.json",
        {
            "approved_tlds_count": 851,
            "counted_ever_count": 851,
            "missing_ever_count": 0,
            "counted_today_core_count": 3,
            "counted_today_rolling_count": 65,
            "seed": coverage_seed,
        },
    )
    _write_json(
        source / "model_latest.json",
        {
            "model_version": "rootfetch_model_v1",
            "methodology_version": "2026-03-01",
            "dvi": 33.4,
            "regime": "STABLE",
            "regime_confidence": 0.82,
        },
    )
    _write_json(source / "treemap_latest.json", {"nodes": [{"tld": "xyz", "value": 1}]})
    _write_json(source / "radar_latest.json", {"points": [{"tld": "xyz", "x": 1, "y": 2}]})
    _write_json(source / "signals_latest.json", {"date_utc": "2026-02-25", "run_id": "abc"})
    (source / "digest_latest.txt").write_text("digest\n", encoding="utf-8")
    rag_dir = source / "rag"
    rag_dir.mkdir(parents=True, exist_ok=True)
    _write_json(rag_dir / "index.json", {"chunks_count": 1})
    (rag_dir / "chunks.jsonl").write_text(
        json.dumps({"id": "c1", "text": "hello"}, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return source


def test_publish_run_writes_manifest_latest_and_replay_sorted(tmp_path: Path) -> None:
    artifacts_root = tmp_path / "artifacts"
    source = _build_source_bundle(tmp_path / "one", coverage_seed=1)

    first_run_id = publish_run(
        PublishInputs(
            artifacts_root=artifacts_root,
            model_version="rootfetch_model_v1",
            snapshot_ts_utc="2026-02-25T23:15:01Z",
            source_dir=source,
        )
    )
    assert first_run_id.startswith("20260225T231501Z_")
    run_dir = artifacts_root / "runs" / first_run_id
    assert run_dir.exists()

    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["run_id"] == first_run_id
    assert manifest["model_version"] == "rootfetch_model_v1"
    assert manifest["methodology_version"] == "2026-03-01"
    assert manifest["files"]

    for entry in manifest["files"]:
        payload = (run_dir / entry["path"]).read_bytes()
        assert len(payload) == entry["size"]
        assert hashlib.sha256(payload).hexdigest() == entry["sha256"]

    latest = json.loads((artifacts_root / "latest.json").read_text(encoding="utf-8"))
    assert latest["run_id"] == first_run_id
    assert latest["model_version"] == "rootfetch_model_v1"
    assert latest["methodology_version"] == "2026-03-01"

    second_source = _build_source_bundle(tmp_path / "two", coverage_seed=2)
    second_run_id = publish_run(
        PublishInputs(
            artifacts_root=artifacts_root,
            model_version="rootfetch_model_v1",
            snapshot_ts_utc="2026-02-25T23:14:01Z",
            source_dir=second_source,
        )
    )
    assert second_run_id.startswith("20260225T231401Z_")

    replay = json.loads((artifacts_root / "replay" / "index.json").read_text(encoding="utf-8"))
    run_ids = [row["run_id"] for row in replay["runs"]]
    timestamps = [row["snapshot_ts_utc"] for row in replay["runs"]]
    assert run_ids == [second_run_id, first_run_id]
    assert timestamps == sorted(timestamps)


def test_publish_run_replay_index_respects_max_runs(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ROOTFETCH_REPLAY_INDEX_MAX_RUNS", "2")
    artifacts_root = tmp_path / "artifacts"
    for idx, ts in enumerate(
        ["2026-02-25T23:10:01Z", "2026-02-25T23:11:01Z", "2026-02-25T23:12:01Z"],
        start=1,
    ):
        source = _build_source_bundle(tmp_path / f"s{idx}", coverage_seed=idx)
        publish_run(
            PublishInputs(
                artifacts_root=artifacts_root,
                model_version="rootfetch_model_v1",
                snapshot_ts_utc=ts,
                source_dir=source,
            )
        )

    replay = json.loads((artifacts_root / "replay" / "index.json").read_text(encoding="utf-8"))
    assert len(replay["runs"]) == 2
    timestamps = [row["snapshot_ts_utc"] for row in replay["runs"]]
    assert timestamps == ["2026-02-25T23:11:01Z", "2026-02-25T23:12:01Z"]


def test_publish_run_is_immutable_for_same_run_id(tmp_path: Path) -> None:
    artifacts_root = tmp_path / "artifacts"
    source = _build_source_bundle(tmp_path, coverage_seed=1)
    inputs = PublishInputs(
        artifacts_root=artifacts_root,
        model_version="rootfetch_model_v1",
        snapshot_ts_utc="2026-02-25T23:15:01Z",
        source_dir=source,
    )
    publish_run(inputs)
    with pytest.raises(FileExistsError):
        publish_run(inputs)


def test_publish_run_missing_input_fails_without_partial_run_dir(tmp_path: Path) -> None:
    artifacts_root = tmp_path / "artifacts"
    source = tmp_path / "source"
    source.mkdir(parents=True, exist_ok=True)
    _write_json(source / "coverage_latest.json", {"approved_tlds_count": 1})

    with pytest.raises(FileNotFoundError):
        publish_run(
            PublishInputs(
                artifacts_root=artifacts_root,
                model_version="rootfetch_model_v1",
                snapshot_ts_utc="2026-02-25T23:15:01Z",
                source_dir=source,
            )
        )
    assert not (artifacts_root / "runs").exists()


def test_prepare_latest_publish_bundle_builds_normalized_outputs(temp_settings, tmp_path: Path) -> None:
    date_utc = "2026-02-25"
    latest_payload = {
        "date_utc": date_utc,
        "run_id": "run-1",
        "model_version": "rootfetch_model_v1",
        "methodology_version": "2026-03-01",
        "dvi": {"score": 33.4},
        "dvi_components": {"dispersion_norm": 0.2},
        "regime": "STABLE",
        "regime_confidence": 0.81,
        "regime_inputs": {"delta_hhi": 0.001},
        "regime_base": "elevated",
        "regime_candidate": "stable",
        "regime_duration_snapshots": 4,
        "dvi_band": "elevated",
        "market_map": {"nodes": []},
        "power_curve": {"points": []},
        "market_risk": {"state": "stable"},
        "top_tlds": [],
        "distribution": {},
        "concentration": {},
        "radar_points": [],
        "anomaly_spotlight": [],
        "pulse": {},
    }
    _write_json(temp_settings.signals_dir / "latest.json", latest_payload)
    _write_json(
        temp_settings.signals_dir / "coverage_latest.json",
        {
            "approved_tlds_count": 851,
            "counted_ever_count": 851,
            "missing_ever_count": 0,
            "counted_today_core_count": 3,
            "counted_today_rolling_count": 65,
        },
    )
    (temp_settings.digests_dir / f"{date_utc}.md").write_text("digest\n", encoding="utf-8")
    _write_json(temp_settings.static_rag_meta_path, {"chunks_count": 2})
    _write_json(
        temp_settings.static_rag_chunks_path,
        [{"id": "c1", "text": "hello"}, {"id": "c2", "text": "world"}],
    )

    out_dir = tmp_path / "prepared"
    snapshot_ts = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    meta = prepare_latest_publish_bundle(
        date_utc=date_utc,
        out_dir=out_dir,
        snapshot_ts_utc=snapshot_ts,
        settings=temp_settings,
    )

    assert meta["date_utc"] == date_utc
    assert (out_dir / "coverage_latest.json").exists()
    assert (out_dir / "model_latest.json").exists()
    assert (out_dir / "treemap_latest.json").exists()
    assert (out_dir / "radar_latest.json").exists()
    assert (out_dir / "signals_latest.json").exists()
    assert (out_dir / "digest_latest.txt").exists()
    assert (out_dir / "snapshot_ts_utc.txt").exists()
    assert (out_dir / "rag" / "index.json").exists()
    assert (out_dir / "rag" / "chunks.jsonl").exists()

    rows = (out_dir / "rag" / "chunks.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(rows) == 2
