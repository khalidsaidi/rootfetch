from __future__ import annotations

import shutil
import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from rootfetch_sdk import CANONICAL_RUN_FILES, FileTransport, RootFetch  # noqa: E402


def _artifacts_root() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "artifacts"


def _client(root: Path) -> RootFetch:
    return RootFetch(transport=FileTransport(root_dir=root))


def test_latest_returns_required_pointer_fields() -> None:
    rf = _client(_artifacts_root())
    latest = rf.latest()
    assert isinstance(latest["run_id"], str)
    assert latest["run_id"]
    assert isinstance(latest["model_version"], str)
    assert isinstance(latest["snapshot_hash"], str)
    assert isinstance(latest["snapshot_ts_utc"], str)


def test_run_returns_canonical_artifacts() -> None:
    rf = _client(_artifacts_root())
    latest = rf.latest()
    bundle = rf.run(latest["run_id"])

    assert bundle["run_id"] == latest["run_id"]
    assert sorted(bundle["artifacts"].keys()) == sorted(CANONICAL_RUN_FILES)
    assert isinstance(bundle["artifacts"]["coverage_latest.json"], dict)
    assert isinstance(bundle["artifacts"]["model_latest.json"], dict)
    assert isinstance(bundle["artifacts"]["digest_latest.txt"], str)
    assert isinstance(bundle["artifacts"]["rag/chunks.jsonl"], str)


def test_verify_manifest_passes_for_committed_run() -> None:
    rf = _client(_artifacts_root())
    latest = rf.latest()
    result = rf.verify_manifest(latest["run_id"])

    assert result["valid"] is True
    assert result["expected_count"] > 0
    assert result["checked_count"] == result["expected_count"]
    assert result["checked_files"] == result["checked_count"]
    assert result["missing_files"] == []
    assert result["mismatched_files"] == []


def test_verify_manifest_fails_when_file_is_tampered(tmp_path: Path) -> None:
    copied = tmp_path / "artifacts"
    shutil.copytree(_artifacts_root(), copied)

    rf = _client(copied)
    latest = rf.latest()
    run_id = latest["run_id"]
    target = copied / "runs" / run_id / "coverage_latest.json"

    payload = bytearray(target.read_bytes())
    payload[0] = (payload[0] + 1) % 256
    target.write_bytes(bytes(payload))

    result = rf.verify_manifest(run_id)
    assert result["valid"] is False
    assert result["checked_count"] == result["expected_count"]
    assert any(item["path"] == "coverage_latest.json" for item in result["mismatched_files"])
