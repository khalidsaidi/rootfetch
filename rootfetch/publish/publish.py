from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rootfetch.config import Settings, get_settings


REQUIRED_SOURCE_FILES = (
    "coverage_latest.json",
    "model_latest.json",
    "treemap_latest.json",
    "radar_latest.json",
    "signals_latest.json",
    "digest_latest.txt",
)

RAG_SOURCE_FILES = (
    ("rag/index.json", "index.json"),
    ("rag/chunks.jsonl", "chunks.jsonl"),
)


@dataclass(frozen=True)
class PublishInputs:
    artifacts_root: Path
    model_version: str
    snapshot_ts_utc: str
    source_dir: Path
    dry_run: bool = False


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _now_utc_z() -> str:
    return _now_utc().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_snapshot_ts_utc(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("snapshot_ts_utc is required")
    try:
        if raw.endswith("Z"):
            dt = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(timezone.utc)
    except Exception as exc:
        raise ValueError(f"Invalid snapshot_ts_utc '{value}' (expected ISO UTC)") from exc
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _snapshot_ts_compact(snapshot_ts_utc: str) -> str:
    parsed = _parse_snapshot_ts_utc(snapshot_ts_utc)
    dt = datetime.strptime(parsed, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _sha256_bytes(payload: bytes) -> str:
    import hashlib

    return hashlib.sha256(payload).hexdigest()


def _json_dumps_canonical(obj: Any) -> bytes:
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except Exception:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.tmp-", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(temp_fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        _fsync_dir(path.parent)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass


def atomic_write_json(path: Path, obj: Any) -> None:
    atomic_write_bytes(path, _json_dumps_canonical(obj))


def _copy_atomic(src: Path, dst: Path) -> tuple[int, str]:
    data = src.read_bytes()
    atomic_write_bytes(dst, data)
    return len(data), _sha256_bytes(data)


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def compute_snapshot_hash(coverage_obj: dict[str, Any]) -> str:
    return _sha256_bytes(_json_dumps_canonical(coverage_obj))


def _safe_get_json_path(path: Path, keys: list[str]) -> Any | None:
    try:
        current: Any = _read_json(path)
        for key in keys:
            if not isinstance(current, dict) or key not in current:
                return None
            current = current[key]
        return current
    except Exception:
        return None


def publish_run(inputs: PublishInputs) -> str:
    coverage_path = inputs.source_dir / "coverage_latest.json"
    if not coverage_path.exists():
        raise FileNotFoundError(f"Missing required publish input: {coverage_path}")
    coverage_obj = _read_json(coverage_path)
    snapshot_hash = compute_snapshot_hash(coverage_obj)

    snapshot_ts_utc = _parse_snapshot_ts_utc(inputs.snapshot_ts_utc)
    snapshot_compact = _snapshot_ts_compact(snapshot_ts_utc)
    run_id = f"{snapshot_compact}_{snapshot_hash[:12]}_{inputs.model_version}"

    runs_dir = inputs.artifacts_root / "runs"
    run_dir = runs_dir / run_id
    if run_dir.exists():
        raise FileExistsError(f"Run already published: {run_dir}")

    required = [(inputs.source_dir / rel, Path(rel)) for rel in REQUIRED_SOURCE_FILES]
    missing_required = [str(src) for src, _ in required if not src.exists()]
    if missing_required:
        raise FileNotFoundError("Missing required publish inputs:\n- " + "\n- ".join(missing_required))

    optional_rag: list[tuple[Path, Path]] = []
    rag_dir = inputs.source_dir / "rag"
    if rag_dir.exists():
        for source_rel, dest_name in RAG_SOURCE_FILES:
            src = inputs.source_dir / source_rel
            if not src.exists():
                raise FileNotFoundError(f"Missing optional rag input: {src}")
            optional_rag.append((src, Path("rag") / dest_name))

    manifest: dict[str, Any] = {
        "run_id": run_id,
        "model_version": inputs.model_version,
        "snapshot_ts_utc": snapshot_ts_utc,
        "snapshot_utc_day": snapshot_ts_utc[:10],
        "snapshot_hash": snapshot_hash,
        "files": [],
    }

    if inputs.dry_run:
        return run_id

    run_dir.mkdir(parents=True, exist_ok=False)
    _fsync_dir(run_dir.parent)

    for src, rel_dst in [*required, *optional_rag]:
        dst = run_dir / rel_dst
        size, file_sha = _copy_atomic(src, dst)
        manifest["files"].append(
            {
                "path": str(rel_dst).replace("\\", "/"),
                "size": int(size),
                "sha256": file_sha,
            }
        )

    atomic_write_json(run_dir / "manifest.json", manifest)

    latest_obj = {
        "run_id": run_id,
        "snapshot_ts_utc": snapshot_ts_utc,
        "snapshot_utc_day": snapshot_ts_utc[:10],
        "snapshot_hash": snapshot_hash,
        "model_version": inputs.model_version,
        "coverage": {
            "approved_tlds_count": coverage_obj.get("approved_tlds_count"),
            "counted_ever_count": coverage_obj.get("counted_ever_count"),
            "missing_ever_count": coverage_obj.get("missing_ever_count"),
            "counted_today_core_count": coverage_obj.get("counted_today_core_count"),
            "counted_today_rolling_count": coverage_obj.get("counted_today_rolling_count"),
        },
    }
    atomic_write_json(inputs.artifacts_root / "latest.json", latest_obj)

    replay_dir = inputs.artifacts_root / "replay"
    replay_dir.mkdir(parents=True, exist_ok=True)
    replay_index_path = replay_dir / "index.json"
    if replay_index_path.exists():
        existing = _read_json(replay_index_path)
        runs = list(existing.get("runs") or [])
    else:
        runs = []

    model_latest_path = inputs.source_dir / "model_latest.json"
    runs.append(
        {
            "run_id": run_id,
            "snapshot_ts_utc": snapshot_ts_utc,
            "snapshot_utc_day": snapshot_ts_utc[:10],
            "snapshot_hash": snapshot_hash,
            "model_version": inputs.model_version,
            "dvi": _safe_get_json_path(model_latest_path, ["dvi"]),
            "regime": _safe_get_json_path(model_latest_path, ["regime"]),
            "regime_confidence": _safe_get_json_path(model_latest_path, ["regime_confidence"]),
        }
    )
    runs.sort(key=lambda row: str(row.get("snapshot_ts_utc") or ""))
    atomic_write_json(replay_index_path, {"runs": runs})

    return run_id


def _as_json_line_rows(chunks_obj: Any) -> list[str]:
    if isinstance(chunks_obj, dict) and "chunks" in chunks_obj:
        chunks_obj = chunks_obj.get("chunks")
    if not isinstance(chunks_obj, list):
        raise ValueError("rag_chunks.json must contain a JSON array or {\"chunks\": [...]}")
    rows: list[str] = []
    for item in chunks_obj:
        rows.append(
            json.dumps(
                item,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
                allow_nan=False,
            )
        )
    return rows


def _model_latest_from_signals(signals_latest: dict[str, Any]) -> dict[str, Any]:
    return {
        "date_utc": signals_latest.get("date_utc"),
        "model_version": signals_latest.get("model_version"),
        "methodology_version": signals_latest.get("methodology_version"),
        "dvi": signals_latest.get("dvi"),
        "dvi_components": signals_latest.get("dvi_components"),
        "regime": signals_latest.get("regime"),
        "regime_confidence": signals_latest.get("regime_confidence"),
        "regime_inputs": signals_latest.get("regime_inputs"),
        "regime_base": signals_latest.get("regime_base"),
        "regime_candidate": signals_latest.get("regime_candidate"),
        "regime_duration_snapshots": signals_latest.get("regime_duration_snapshots"),
        "dvi_band": signals_latest.get("dvi_band"),
        "model_effective_date_utc": signals_latest.get("model_effective_date_utc"),
    }


def _treemap_latest_from_signals(signals_latest: dict[str, Any]) -> dict[str, Any]:
    return {
        "date_utc": signals_latest.get("date_utc"),
        "market_map": signals_latest.get("market_map"),
        "top_tlds": signals_latest.get("top_tlds"),
        "distribution": signals_latest.get("distribution"),
        "concentration": signals_latest.get("concentration"),
        "market_risk": signals_latest.get("market_risk"),
        "power_curve": signals_latest.get("power_curve"),
    }


def _radar_latest_from_signals(signals_latest: dict[str, Any]) -> dict[str, Any]:
    return {
        "date_utc": signals_latest.get("date_utc"),
        "radar_points": signals_latest.get("radar_points"),
        "anomaly_spotlight": signals_latest.get("anomaly_spotlight"),
        "pulse": signals_latest.get("pulse"),
    }


def prepare_latest_publish_bundle(
    *,
    date_utc: str,
    out_dir: Path,
    snapshot_ts_utc: str | None = None,
    model_version: str = "rootfetch_model_v1",
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "rag").mkdir(parents=True, exist_ok=True)

    normalized_ts = _parse_snapshot_ts_utc(snapshot_ts_utc or _now_utc_z())

    coverage_path = settings.signals_dir / "coverage_latest.json"
    latest_signals_path = settings.signals_dir / "latest.json"
    if not coverage_path.exists():
        raise FileNotFoundError(f"Missing {coverage_path}")
    if not latest_signals_path.exists():
        raise FileNotFoundError(f"Missing {latest_signals_path}")

    coverage_obj = _read_json(coverage_path)
    signals_latest = _read_json(latest_signals_path)
    digest_dated = settings.digests_dir / f"{date_utc}.md"
    digest_latest = settings.digests_dir / "latest.md"
    digest_path = digest_dated if digest_dated.exists() else digest_latest
    if not digest_path.exists():
        raise FileNotFoundError(f"Missing digest file: {digest_dated} or {digest_latest}")

    atomic_write_json(out_dir / "coverage_latest.json", coverage_obj)
    atomic_write_json(out_dir / "signals_latest.json", signals_latest)
    atomic_write_json(out_dir / "model_latest.json", _model_latest_from_signals(signals_latest))
    atomic_write_json(out_dir / "treemap_latest.json", _treemap_latest_from_signals(signals_latest))
    atomic_write_json(out_dir / "radar_latest.json", _radar_latest_from_signals(signals_latest))
    atomic_write_bytes(out_dir / "digest_latest.txt", digest_path.read_bytes())
    atomic_write_bytes(out_dir / "snapshot_ts_utc.txt", (normalized_ts + "\n").encode("utf-8"))
    atomic_write_bytes(out_dir / "model_version.txt", (model_version + "\n").encode("utf-8"))

    if settings.static_rag_meta_path.exists():
        atomic_write_bytes(out_dir / "rag" / "index.json", settings.static_rag_meta_path.read_bytes())
    if settings.static_rag_chunks_path.exists():
        with settings.static_rag_chunks_path.open("r", encoding="utf-8") as handle:
            chunks_obj = json.load(handle)
        rows = _as_json_line_rows(chunks_obj)
        atomic_write_bytes(out_dir / "rag" / "chunks.jsonl", ("\n".join(rows) + ("\n" if rows else "")).encode("utf-8"))

    snapshot_hash = compute_snapshot_hash(coverage_obj)
    run_id_preview = f"{_snapshot_ts_compact(normalized_ts)}_{snapshot_hash[:12]}_{model_version}"
    return {
        "date_utc": date_utc,
        "out_dir": str(out_dir),
        "snapshot_ts_utc": normalized_ts,
        "model_version": model_version,
        "snapshot_hash": snapshot_hash,
        "run_id_preview": run_id_preview,
        "coverage_path": str(out_dir / "coverage_latest.json"),
        "signals_path": str(out_dir / "signals_latest.json"),
        "model_path": str(out_dir / "model_latest.json"),
        "treemap_path": str(out_dir / "treemap_latest.json"),
        "radar_path": str(out_dir / "radar_latest.json"),
        "digest_path": str(out_dir / "digest_latest.txt"),
    }
