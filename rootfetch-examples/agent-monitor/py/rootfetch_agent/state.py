from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict


AgentState = Dict[str, Any]


def _empty_state() -> AgentState:
    return {"last_seen_run_id": None, "notified_keys": {}}


def load_state(state_path: Path) -> AgentState:
    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_state()

    if not isinstance(raw, dict):
        return _empty_state()
    notified = raw.get("notified_keys")
    notified_keys = notified if isinstance(notified, dict) else {}
    normalized_notified: Dict[str, str] = {}
    for key, value in notified_keys.items():
        if isinstance(key, str) and isinstance(value, str):
            normalized_notified[key] = value

    return {
        "last_seen_run_id": raw.get("last_seen_run_id") if isinstance(raw.get("last_seen_run_id"), str) else None,
        "notified_keys": normalized_notified,
    }


def prune_notified(state: AgentState, max_age_hours: float, now_utc: datetime) -> None:
    cutoff = now_utc - timedelta(hours=max(1.0, max_age_hours))
    notified = state.get("notified_keys")
    if not isinstance(notified, dict):
        state["notified_keys"] = {}
        return
    for key, value in list(notified.items()):
        try:
            ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            del notified[key]
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts < cutoff:
            del notified[key]


def is_notified(state: AgentState, dedup_key: str) -> bool:
    notified = state.get("notified_keys")
    return isinstance(notified, dict) and isinstance(notified.get(dedup_key), str)


def mark_notified(state: AgentState, dedup_key: str, now_iso: str) -> None:
    notified = state.setdefault("notified_keys", {})
    if not isinstance(notified, dict):
        state["notified_keys"] = {}
        notified = state["notified_keys"]
    notified[dedup_key] = now_iso


def save_state_atomic(state_path: Path, state: AgentState) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = state_path.with_name(f"{state_path.name}.tmp.{os.getpid()}.{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}")
    payload = json.dumps(state, indent=2) + "\n"

    with open(tmp_path, "w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())

    os.replace(tmp_path, state_path)
    dir_fd = os.open(str(state_path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)

