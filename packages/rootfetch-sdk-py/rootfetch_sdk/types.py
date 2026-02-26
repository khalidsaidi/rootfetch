from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class ManifestFile(TypedDict):
    path: str
    size: int
    sha256: str


class LatestCoverage(TypedDict, total=False):
    approved_tlds_count: int
    counted_ever_count: int
    counted_today_core_count: int
    counted_today_rolling_count: int
    missing_ever_count: int


class LatestPointer(TypedDict):
    run_id: str
    model_version: str
    snapshot_hash: str
    snapshot_ts_utc: str
    snapshot_utc_day: str
    coverage: LatestCoverage


class ReplayRun(TypedDict, total=False):
    run_id: str
    snapshot_ts_utc: str
    snapshot_utc_day: str
    snapshot_hash: str
    model_version: str
    dvi: Any
    regime: str
    regime_confidence: float


class ReplayIndex(TypedDict):
    runs: List[ReplayRun]


class Manifest(TypedDict):
    run_id: str
    model_version: str
    snapshot_hash: str
    snapshot_ts_utc: str
    snapshot_utc_day: str
    files: List[ManifestFile]


class RunBundle(TypedDict):
    run_id: str
    manifest: Manifest
    artifacts: Dict[str, Any]


class MismatchedFile(TypedDict):
    path: str
    expected_sha256: str
    actual_sha256: Optional[str]


class VerificationResult(TypedDict):
    run_id: str
    valid: bool
    expected_count: int
    checked_count: int
    checked_files: int
    missing_files: List[str]
    mismatched_files: List[MismatchedFile]
