#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _load_env_files(paths: list[str]) -> None:
    for raw in paths:
        candidate = raw.strip()
        if not candidate:
            continue
        _load_dotenv_file(Path(candidate))


def _http_get_json(url: str, timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _http_post_json(
    url: str,
    payload: dict[str, Any],
    token: str,
    origin: str,
    timeout: int,
    session_id: str | None,
) -> tuple[dict[str, Any], str | None]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if origin:
        headers["Origin"] = origin
    if session_id:
        headers["mcp-session-id"] = session_id

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        content_type = (response.headers.get("content-type") or "").lower()
        next_session = response.headers.get("mcp-session-id") or session_id

    if "text/event-stream" in content_type:
        parsed: dict[str, Any] | None = None
        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line.startswith("data:"):
                continue
            payload_text = line[5:].strip()
            if not payload_text:
                continue
            try:
                candidate = json.loads(payload_text)
            except Exception:
                continue
            if isinstance(candidate, dict):
                parsed = candidate
        if parsed is None:
            raise RuntimeError("mcp_sse_parse_error: no JSON data event found")
        return parsed, next_session

    return json.loads(body), next_session


def _extract_tool_json(mcp_response: dict[str, Any]) -> dict[str, Any]:
    result = mcp_response.get("result")
    if not isinstance(result, dict):
        return {}
    content = result.get("content")
    if not isinstance(content, list) or not content:
        return {}
    first = content[0]
    if not isinstance(first, dict):
        return {}
    text = first.get("text")
    if not isinstance(text, str):
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {"raw_text": text}
    return parsed if isinstance(parsed, dict) else {"raw_payload": parsed}


def _mcp_tool_call(
    endpoint: str,
    token: str,
    origin: str,
    timeout: int,
    name: str,
    arguments: dict[str, Any],
    req_id: int,
    session_id: str | None,
) -> tuple[dict[str, Any], str | None]:
    payload = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    response, next_session = _http_post_json(endpoint, payload, token, origin, timeout, session_id)
    if "error" in response:
        raise RuntimeError(f"mcp_error({name}): {response['error']}")
    return _extract_tool_json(response), next_session


def _initialize_session(
    endpoint: str,
    token: str,
    origin: str,
    timeout: int,
) -> str | None:
    session_id: str | None = None
    init_payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "rootfetch-mcp-live-check", "version": "1.0.0"},
        },
    }
    init_resp, session_id = _http_post_json(endpoint, init_payload, token, origin, timeout, session_id)
    if "error" in init_resp:
        raise RuntimeError(f"mcp_initialize_error: {init_resp['error']}")

    initialized_payload = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
    try:
        _http_post_json(endpoint, initialized_payload, token, origin, timeout, session_id)
    except Exception:
        pass
    return session_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--endpoint",
        default=None,
        help="MCP endpoint URL (default from ROOTFETCH_MCP_URL or https://rootfetch.com/mcp)",
    )
    parser.add_argument(
        "--origin",
        default=None,
        help="Optional Origin header value (default from ROOTFETCH_MCP_ORIGIN)",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="Optional bearer token (default from ROOTFETCH_MCP_TOKEN).",
    )
    parser.add_argument(
        "--artifact-base-url",
        default=None,
        help="Public artifact base URL (default from ROOTFETCH_PUBLIC_BASE_URL or https://rootfetch.com)",
    )
    parser.add_argument(
        "--env-file",
        action="append",
        default=[],
        help="Optional dotenv file(s) to load before reading env vars (can repeat).",
    )
    parser.add_argument(
        "--no-default-env-files",
        action="store_true",
        help="Disable automatic loading of .env and .env.mcp.",
    )
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    env_files: list[str] = []
    if not args.no_default_env_files:
        env_files.extend([".env", ".env.mcp"])
    env_files.extend(args.env_file)
    _load_env_files(env_files)

    endpoint = (args.endpoint or os.getenv("ROOTFETCH_MCP_URL") or "https://rootfetch.com/mcp").strip()
    origin = (args.origin or os.getenv("ROOTFETCH_MCP_ORIGIN") or "").strip()
    token = (args.token or os.getenv("ROOTFETCH_MCP_TOKEN") or "").strip()
    artifact_base_url = (
        args.artifact_base_url or os.getenv("ROOTFETCH_PUBLIC_BASE_URL") or "https://rootfetch.com"
    ).rstrip("/")

    try:
        pointer_artifact = _http_get_json(f"{artifact_base_url}/rootfetch/artifacts/latest.json", args.timeout)
        run_id = str(pointer_artifact.get("run_id") or "").strip()
        if not run_id:
            print("error: artifact latest pointer missing run_id", file=sys.stderr)
            return 2

        run_id_enc = urllib.parse.quote(run_id, safe="")
        coverage_artifact = _http_get_json(
            f"{artifact_base_url}/rootfetch/artifacts/runs/{run_id_enc}/coverage_latest.json", args.timeout
        )
        signals_artifact = _http_get_json(
            f"{artifact_base_url}/rootfetch/artifacts/runs/{run_id_enc}/signals_latest.json", args.timeout
        )

        session_id = _initialize_session(endpoint, token, origin, args.timeout)

        latest_tool, session_id = _mcp_tool_call(
            endpoint,
            token,
            origin,
            args.timeout,
            "rootfetch.latest",
            {},
            2,
            session_id,
        )
        replay_tool, session_id = _mcp_tool_call(
            endpoint,
            token,
            origin,
            args.timeout,
            "rootfetch.replay_index",
            {},
            3,
            session_id,
        )
        manifest_tool, session_id = _mcp_tool_call(
            endpoint,
            token,
            origin,
            args.timeout,
            "rootfetch.run_manifest",
            {"run_id": run_id},
            4,
            session_id,
        )
        bundle_tool, session_id = _mcp_tool_call(
            endpoint,
            token,
            origin,
            args.timeout,
            "rootfetch.run_bundle",
            {"run_id": run_id},
            5,
            session_id,
        )
        compare_tool, session_id = _mcp_tool_call(
            endpoint,
            token,
            origin,
            args.timeout,
            "rootfetch.compare_link",
            {"left": run_id, "right": run_id},
            6,
            session_id,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"error: http_status={exc.code} body={body}", file=sys.stderr)
        return 3
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3

    latest_run_tool = str(latest_tool.get("run_id") or "")
    replay_count = int(replay_tool.get("count") or 0)

    manifest_expected = int(manifest_tool.get("expected_count") or 0)
    manifest_checked = int(manifest_tool.get("checked_count") or 0)
    manifest_missing = manifest_tool.get("missing_files") or []

    bundle_run_tool = str(bundle_tool.get("run_id") or "")
    bundle_coverage = bundle_tool.get("coverage") if isinstance(bundle_tool.get("coverage"), dict) else {}
    bundle_signals = bundle_tool.get("signals") if isinstance(bundle_tool.get("signals"), dict) else {}

    approved_tool = int(bundle_coverage.get("approved_tlds_count") or 0)
    approved_artifact = int(coverage_artifact.get("approved_tlds_count") or 0)

    snapshot_tool = str(bundle_signals.get("date_utc") or "")
    snapshot_artifact = str(signals_artifact.get("date_utc") or "")

    compare_url = str(compare_tool.get("compare_url") or "")

    print(f"mcp_tool_run_id={latest_run_tool}")
    print(f"artifact_run_id={run_id}")
    print(f"replay_count={replay_count}")
    print(f"manifest_expected_count={manifest_expected}")
    print(f"manifest_checked_count={manifest_checked}")
    print(f"manifest_missing_files={len(manifest_missing) if isinstance(manifest_missing, list) else 0}")
    print(f"coverage_approved_tool={approved_tool}")
    print(f"coverage_approved_artifact={approved_artifact}")
    print(f"snapshot_date_tool={snapshot_tool}")
    print(f"snapshot_date_artifact={snapshot_artifact}")
    print(f"compare_url={compare_url}")

    run_id_match = latest_run_tool == run_id == bundle_run_tool
    manifest_ok = manifest_expected > 0 and manifest_expected == manifest_checked and isinstance(manifest_missing, list) and len(manifest_missing) == 0
    coverage_match = approved_tool == approved_artifact
    snapshot_match = snapshot_tool == snapshot_artifact and snapshot_tool != ""
    replay_ok = replay_count > 0
    compare_ok = compare_url.endswith(f"left={run_id}&right={run_id}")

    print(f"run_id_match={run_id_match}")
    print(f"manifest_ok={manifest_ok}")
    print(f"coverage_match={coverage_match}")
    print(f"snapshot_match={snapshot_match}")
    print(f"replay_ok={replay_ok}")
    print(f"compare_ok={compare_ok}")

    if all([run_id_match, manifest_ok, coverage_match, snapshot_match, replay_ok, compare_ok]):
        return 0

    print("error: mcp_live_check assertion failed", file=sys.stderr)
    return 4


if __name__ == "__main__":
    raise SystemExit(main())
