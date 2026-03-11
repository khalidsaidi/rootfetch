import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request
from google.cloud import firestore

app = Flask(__name__)

INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "").strip()
COLLECTION_NAME = os.environ.get("FIRESTORE_COLLECTION", "rootfetch_mcp_events").strip() or "rootfetch_mcp_events"

_db = firestore.Client()
_events = _db.collection(COLLECTION_NAME)


def _unauthorized() -> Any:
    return jsonify({"error": "unauthorized"}), 401


def _forbidden() -> Any:
    return jsonify({"error": "forbidden"}), 403


def _extract_bearer() -> str:
    auth = (request.headers.get("Authorization") or "").strip()
    if not auth.lower().startswith("bearer "):
        return ""
    return auth.split(" ", 1)[1].strip()


def _require_token() -> Optional[Any]:
    if not INGEST_TOKEN:
        return jsonify({"error": "ingest_token_not_configured"}), 503
    token = _extract_bearer()
    if not token:
        return _unauthorized()
    if token != INGEST_TOKEN:
        return _forbidden()
    return None


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_bool(value: Any) -> bool:
    return bool(value)


def _normalize_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    ts = str(payload.get("ts_utc") or now.isoformat())
    epoch_ms = _safe_int(payload.get("epoch_ms"), int(time.time() * 1000))

    event = {
        "ts_utc": ts,
        "epoch_ms": epoch_ms,
        "date_utc": datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d"),
        "http_method": str(payload.get("http_method") or "").upper() or "POST",
        "rpc_method": payload.get("rpc_method") if isinstance(payload.get("rpc_method"), str) else None,
        "tool_name": payload.get("tool_name") if isinstance(payload.get("tool_name"), str) else None,
        "status": _safe_int(payload.get("status"), 0),
        "duration_ms": max(0, _safe_int(payload.get("duration_ms"), 0)),
        "rate_limited": _safe_bool(payload.get("rate_limited")),
        "kind": str(payload.get("kind") or "mcp_request"),
        "limiter_mode": str(payload.get("limiter_mode") or "local"),
        "ip_hash": str(payload.get("ip_hash") or "unknown"),
        "ingested_at": firestore.SERVER_TIMESTAMP,
    }
    return event


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "ok", "service": "rootfetch-mcp-telemetry", "collection": COLLECTION_NAME})


@app.post("/ingest")
def ingest() -> Any:
    auth_err = _require_token()
    if auth_err:
        return auth_err

    if not request.is_json:
        return jsonify({"error": "invalid_json"}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid_payload"}), 400

    event = _normalize_event(payload)
    _events.add(event)
    return jsonify({"ok": True}), 200


@app.get("/events")
def events() -> Any:
    auth_err = _require_token()
    if auth_err:
        return auth_err

    limit = max(1, min(200, _safe_int(request.args.get("limit"), 50)))
    rpc_method = (request.args.get("rpc_method") or "").strip()
    tool_name = (request.args.get("tool_name") or "").strip()
    kind = (request.args.get("kind") or "").strip()
    status_raw = (request.args.get("status") or "").strip()
    status = _safe_int(status_raw, -1) if status_raw else None

    docs = _events.order_by("epoch_ms", direction=firestore.Query.DESCENDING).limit(1000).stream()

    rows: List[Dict[str, Any]] = []
    for doc in docs:
        row = doc.to_dict() or {}
        if rpc_method and row.get("rpc_method") != rpc_method:
            continue
        if tool_name and row.get("tool_name") != tool_name:
            continue
        if kind and row.get("kind") != kind:
            continue
        if status is not None and _safe_int(row.get("status"), -999) != status:
            continue

        row.pop("ingested_at", None)
        rows.append(row)
        if len(rows) >= limit:
            break

    return jsonify(
        {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "mode": "shared",
            "events": rows,
        }
    )


@app.get("/stats")
def stats() -> Any:
    auth_err = _require_token()
    if auth_err:
        return auth_err

    days = max(1, min(30, _safe_int(request.args.get("days"), 7)))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days - 1)
    start_epoch_ms = int(start.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)

    docs = _events.where("epoch_ms", ">=", start_epoch_ms).stream()

    totals = {"requests": 0, "rate_limited": 0, "errors": 0}
    by_status: Dict[str, int] = {}
    by_http_method: Dict[str, int] = {}
    by_rpc_method: Dict[str, int] = {}
    by_kind: Dict[str, int] = {}
    by_tool: Dict[str, int] = {}
    daily_map: Dict[str, Dict[str, int]] = {}
    unique_ips: set[str] = set()
    requests_by_ip: Dict[str, int] = {}
    tool_call_requests = 0
    tool_call_success = 0
    initialize_requests = 0

    def bump(target: Dict[str, int], key: Optional[str]) -> None:
        if not key:
            return
        target[key] = target.get(key, 0) + 1

    for doc in docs:
        row = doc.to_dict() or {}
        totals["requests"] += 1
        if _safe_bool(row.get("rate_limited")):
            totals["rate_limited"] += 1
        status = _safe_int(row.get("status"), 0)
        if status >= 400:
            totals["errors"] += 1
        rpc_method_value = str(row.get("rpc_method") or "")
        if rpc_method_value == "tools/call":
            tool_call_requests += 1
            if status < 400:
                tool_call_success += 1
        elif rpc_method_value == "initialize":
            initialize_requests += 1

        bump(by_status, str(status))
        bump(by_http_method, str(row.get("http_method") or ""))
        bump(by_rpc_method, str(row.get("rpc_method") or ""))
        bump(by_kind, str(row.get("kind") or ""))
        bump(by_tool, str(row.get("tool_name") or ""))

        ip_hash = str(row.get("ip_hash") or "")
        if ip_hash:
            unique_ips.add(ip_hash)
            requests_by_ip[ip_hash] = requests_by_ip.get(ip_hash, 0) + 1

        date_utc = str(row.get("date_utc") or "")
        if not date_utc:
            epoch_ms = _safe_int(row.get("epoch_ms"), 0)
            if epoch_ms > 0:
                date_utc = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            else:
                date_utc = now.strftime("%Y-%m-%d")

        slot = daily_map.setdefault(date_utc, {"requests": 0, "rate_limited": 0, "errors": 0})
        slot["requests"] += 1
        if _safe_bool(row.get("rate_limited")):
            slot["rate_limited"] += 1
        if status >= 400:
            slot["errors"] += 1

    day_list: List[Dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        day = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
        slot = daily_map.get(day, {"requests": 0, "rate_limited": 0, "errors": 0})
        day_list.append(
            {
                "date_utc": day,
                "requests": slot["requests"],
                "rate_limited": slot["rate_limited"],
                "errors": slot["errors"],
            }
        )

    unique_clients = len(unique_ips)
    repeat_clients = sum(1 for count in requests_by_ip.values() if count >= 2)
    repeat_client_rate_pct = (repeat_clients / unique_clients * 100.0) if unique_clients else 0.0
    tool_call_success_rate_pct = (tool_call_success / tool_call_requests * 100.0) if tool_call_requests else 0.0

    return jsonify(
        {
            "mode": "shared",
            "generated_at_utc": now.isoformat(),
            "window_days": days,
            "totals": totals,
            "by_status": by_status,
            "by_http_method": by_http_method,
            "by_rpc_method": by_rpc_method,
            "by_kind": by_kind,
            "by_tool": by_tool,
            "daily": day_list,
            "adoption_kpi": {
                "unique_clients": unique_clients,
                "repeat_clients": repeat_clients,
                "repeat_client_rate_pct": round(repeat_client_rate_pct, 3),
                "tool_call_requests": tool_call_requests,
                "tool_call_success_rate_pct": round(tool_call_success_rate_pct, 3),
                "initialize_requests": initialize_requests,
                "weekly_active_clients_proxy": unique_clients if days <= 7 else None,
            },
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
