from __future__ import annotations

import json
from typing import Any, Dict, Optional

import requests


def notify_webhook(
    *,
    webhook_url: Optional[str],
    payload: Dict[str, Any],
    dedup_key: str,
    timeout_seconds: float,
    dry_run: bool,
) -> Dict[str, Any]:
    if dry_run:
        print(json.dumps({"dry_run": True, "dedup_key": dedup_key, "payload": payload}, indent=2))
        return {"delivered": True, "mode": "dry-run"}

    if not webhook_url:
        print(json.dumps({"stdout_only": True, "dedup_key": dedup_key, "payload": payload}, indent=2))
        return {"delivered": True, "mode": "stdout"}

    response = requests.post(
        webhook_url,
        json=payload,
        timeout=timeout_seconds,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "rootfetch-agent-monitor-py/0.1.0",
            "Idempotency-Key": dedup_key,
            "X-RootFetch-Dedup-Key": dedup_key,
        },
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Webhook {response.status_code}: {response.text[:280]}")
    return {"delivered": True, "mode": "webhook", "status": response.status_code}

