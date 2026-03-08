from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

from .transport import HttpTransport, Transport

CANONICAL_RUN_FILES = (
    "coverage_latest.json",
    "model_latest.json",
    "treemap_latest.json",
    "radar_latest.json",
    "signals_latest.json",
    "digest_latest.txt",
    "rag/index.json",
    "rag/chunks.jsonl",
)


def _ensure_run_id(run_id: str) -> str:
    value = (run_id or "").strip()
    if not value:
        raise ValueError("run_id must be non-empty.")
    return value


class RootFetch:
    def __init__(self, base_url: str = "https://rootfetch.com", transport: Transport | None = None) -> None:
        self._transport: Transport = transport or HttpTransport(base_url=base_url)

    def latest(self) -> Dict[str, Any]:
        return self._read_json("latest.json")

    def replay(self) -> Dict[str, Any]:
        return self._read_json("replay/index.json")

    def run(self, run_id: str) -> Dict[str, Any]:
        safe_run_id = _ensure_run_id(run_id)
        manifest = self._read_json(f"runs/{safe_run_id}/manifest.json")
        manifest_paths = {entry.get("path") for entry in manifest.get("files", []) if isinstance(entry, dict)}
        missing = [item for item in CANONICAL_RUN_FILES if item not in manifest_paths]
        if missing:
            raise ValueError(
                f"run {safe_run_id} missing canonical artifacts in manifest: {', '.join(missing)}"
            )

        artifacts: Dict[str, Any] = {}
        for relative_path in CANONICAL_RUN_FILES:
            payload = self._transport.get_bytes(f"runs/{safe_run_id}/{relative_path}")
            artifacts[relative_path] = self._parse_artifact(relative_path, payload)

        return {
            "run_id": safe_run_id,
            "manifest": manifest,
            "artifacts": artifacts,
        }

    def verify_manifest(self, run_id: str) -> Dict[str, Any]:
        safe_run_id = _ensure_run_id(run_id)
        manifest = self._read_json(f"runs/{safe_run_id}/manifest.json")
        files = manifest.get("files", [])
        if not isinstance(files, list):
            files = []

        missing_files = []
        mismatched_files = []
        checked_count = 0

        for entry in files:
            if not isinstance(entry, dict):
                continue
            relative_path = str(entry.get("path") or "")
            expected_sha = str(entry.get("sha256") or "").lower()
            if not relative_path or not expected_sha:
                missing_files.append(relative_path)
                continue
            try:
                payload = self._transport.get_bytes(f"runs/{safe_run_id}/{relative_path}")
            except Exception:
                missing_files.append(relative_path)
                continue
            actual_sha = hashlib.sha256(payload).hexdigest()
            checked_count += 1
            if actual_sha != expected_sha:
                mismatched_files.append(
                    {
                        "path": relative_path,
                        "expected_sha256": expected_sha,
                        "actual_sha256": actual_sha,
                    }
                )

        return {
            "run_id": safe_run_id,
            "valid": not missing_files and not mismatched_files,
            "expected_count": len(files),
            "checked_count": checked_count,
            "checked_files": checked_count,
            "missing_files": missing_files,
            "mismatched_files": mismatched_files,
        }

    def _read_json(self, relative_path: str) -> Dict[str, Any]:
        payload = self._transport.get_bytes(relative_path)
        try:
            return json.loads(payload.decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"invalid JSON at {relative_path}: {exc}") from exc

    @staticmethod
    def _parse_artifact(relative_path: str, payload: bytes) -> Any:
        if relative_path.endswith(".json"):
            return json.loads(payload.decode("utf-8"))
        if relative_path.endswith(".txt") or relative_path.endswith(".jsonl"):
            return payload.decode("utf-8")
        return payload
