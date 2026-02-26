from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .notify_webhook import notify_webhook
from .policy import RunSnapshot, build_run_snapshot, evaluate_policies
from .state import is_notified, load_state, mark_notified, prune_notified, save_state_atomic


def _as_float(raw: Optional[str], fallback: float) -> float:
    try:
        out = float(raw) if raw is not None else fallback
    except Exception:
        return fallback
    return out if out == out else fallback


def _normalize_base_url(raw: str) -> str:
    return raw.rstrip("/")


def _dedup_key(parts: list[str]) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _load_sdk() -> Any:
    try:
        from rootfetch_sdk import RootFetch  # type: ignore

        return RootFetch
    except Exception:
        repo_root = Path(__file__).resolve().parents[4]
        sdk_root = repo_root / "packages" / "rootfetch-sdk-py"
        sys.path.insert(0, str(sdk_root))
        from rootfetch_sdk import RootFetch  # type: ignore

        return RootFetch


def _load_previous_snapshot(client: Any, run_id: str) -> Optional[RunSnapshot]:
    try:
        previous_bundle = client.run(run_id)
    except Exception:
        return None
    return build_run_snapshot(run_id, {}, previous_bundle)


def run_monitor(*, dry_run: bool) -> Dict[str, Any]:
    base_url = _normalize_base_url(os.getenv("ROOTFETCH_BASE_URL", "https://rootfetch.vercel.app"))
    webhook_url = os.getenv("WEBHOOK_URL")
    state_path = Path(os.getenv("ROOTFETCH_STATE_PATH", ".rootfetch-agent-state.json")).resolve()
    dvi_threshold = _as_float(os.getenv("ROOTFETCH_DVI_THRESHOLD"), 50.0)
    top_mover_z_threshold = _as_float(os.getenv("ROOTFETCH_TOP_MOVER_Z_THRESHOLD"), 2.5)
    dedup_hours = _as_float(os.getenv("ROOTFETCH_DEDUP_HOURS"), 168.0)
    timeout_seconds = max(1.0, _as_float(os.getenv("ROOTFETCH_TIMEOUT_SECONDS"), 15.0))

    state = load_state(state_path)
    now_utc = datetime.now(tz=timezone.utc)
    prune_notified(state, dedup_hours, now_utc)

    RootFetch = _load_sdk()
    client = RootFetch(base_url=base_url)
    latest = client.latest()
    run_id = str(latest.get("run_id") or "").strip()
    if not run_id:
        raise RuntimeError("latest() returned empty run_id")

    verification = client.verify_manifest(run_id)
    if not verification.get("valid"):
        raise RuntimeError(
            f"Manifest verification failed for {run_id}. "
            f"missing={len(verification.get('missing_files', []))} "
            f"mismatched={len(verification.get('mismatched_files', []))}"
        )

    current_bundle = client.run(run_id)
    current = build_run_snapshot(run_id, latest, current_bundle)

    previous_run_id = state.get("last_seen_run_id")
    if not isinstance(previous_run_id, str) or previous_run_id == run_id:
        previous_run_id = None
    previous = _load_previous_snapshot(client, previous_run_id) if previous_run_id else None

    alerts = evaluate_policies(
        current=current,
        previous=previous,
        dvi_threshold=dvi_threshold,
        top_mover_z_threshold=top_mover_z_threshold,
    )

    delivered = 0
    skipped = 0
    for alert in alerts:
        key = _dedup_key(
            [
                alert.policy_id,
                run_id,
                current.snapshot_ts_utc,
                current.regime,
                str(round(current.dvi * 10.0)),
                alert.summary,
            ]
        )
        if is_notified(state, key):
            skipped += 1
            continue

        run_url = f"{base_url}/runs/{run_id}"
        compare_url = f"{base_url}/compare?left={previous_run_id}&right={run_id}" if previous_run_id else None
        payload = {
            "source": "rootfetch-agent-monitor-py",
            "policy_id": alert.policy_id,
            "severity": alert.severity,
            "summary": alert.summary,
            "details": alert.details,
            "run_id": run_id,
            "snapshot_ts_utc": current.snapshot_ts_utc,
            "model_version": current.model_version,
            "regime": current.regime,
            "dvi": round(current.dvi, 1),
            "regime_confidence": round(current.regime_confidence, 4),
            "links": {
                "run_url": run_url,
                "compare_url": compare_url,
            },
            "dedup_key": key,
        }
        notify_webhook(
            webhook_url=webhook_url,
            payload=payload,
            dedup_key=key,
            timeout_seconds=timeout_seconds,
            dry_run=dry_run,
        )
        mark_notified(state, key, now_utc.isoformat())
        delivered += 1

    state["last_seen_run_id"] = run_id
    save_state_atomic(state_path, state)

    result = {
        "run_id": run_id,
        "previous_run_id": previous_run_id,
        "alerts_evaluated": len(alerts),
        "alerts_delivered": delivered,
        "alerts_skipped_dedup": skipped,
        "dry_run": dry_run,
        "state_path": str(state_path),
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="RootFetch artifact monitor (Python example).")
    parser.add_argument("--dry-run", action="store_true", help="Evaluate and print alerts without webhook delivery.")
    args = parser.parse_args()

    try:
        run_monitor(dry_run=args.dry_run)
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

