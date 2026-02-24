#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


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
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Origin": origin,
    }
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
        next_session = response.headers.get("mcp-session-id") or session_id
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

    # Best-effort initialized notification; some handlers are fully stateless.
    initialized_payload = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
    try:
        _http_post_json(endpoint, initialized_payload, token, origin, timeout, session_id)
    except Exception:
        pass
    return session_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default=os.getenv("ROOTFETCH_MCP_URL", "https://rootfetch.vercel.app/api/mcp"))
    parser.add_argument("--origin", default=os.getenv("ROOTFETCH_MCP_ORIGIN", "https://rootfetch.vercel.app"))
    parser.add_argument("--query", default=os.getenv("ROOTFETCH_MCP_RAG_QUERY", "anomaly"))
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    token = os.getenv("ROOTFETCH_MCP_TOKEN", "").strip()
    if not token:
        print("error: missing ROOTFETCH_MCP_TOKEN", file=sys.stderr)
        return 2

    try:
        approved_latest = _http_get_json("https://rootfetch.vercel.app/rootfetch/approved_latest.json", args.timeout)
        coverage_latest = _http_get_json("https://rootfetch.vercel.app/rootfetch/coverage_latest.json", args.timeout)

        session_id = _initialize_session(args.endpoint, token, args.origin, args.timeout)
        approved_tool, session_id = _mcp_tool_call(
            args.endpoint,
            token,
            args.origin,
            args.timeout,
            "rootfetch_get_approved_tlds",
            {},
            2,
            session_id,
        )
        coverage_tool, session_id = _mcp_tool_call(
            args.endpoint,
            token,
            args.origin,
            args.timeout,
            "rootfetch_get_coverage",
            {},
            3,
            session_id,
        )
        rag_tool, session_id = _mcp_tool_call(
            args.endpoint,
            token,
            args.origin,
            args.timeout,
            "rag_search",
            {"query": args.query, "k": 5},
            4,
            session_id,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"error: http_status={exc.code} body={body}", file=sys.stderr)
        return 3
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3

    approved_count_tool = int(approved_tool.get("count") or 0)
    coverage_missing_tool = int(coverage_tool.get("missing_ever_count") or 0)
    coverage_counted_ever_tool = int(coverage_tool.get("counted_ever_count") or 0)
    rag_hits = rag_tool.get("hits") or []
    rag_hits_count = len(rag_hits) if isinstance(rag_hits, list) else 0

    approved_count_artifact = int(approved_latest.get("count") or 0)
    coverage_missing_artifact = int(coverage_latest.get("missing_ever_count") or 0)
    coverage_counted_ever_artifact = int(coverage_latest.get("counted_ever_count") or 0)

    print(f"mcp_tool_approved_count={approved_count_tool}")
    print(f"mcp_tool_missing_ever={coverage_missing_tool}")
    print(f"mcp_tool_counted_ever={coverage_counted_ever_tool}")
    print(f"mcp_rag_hits={rag_hits_count}")
    print(f"artifact_approved_count={approved_count_artifact}")
    print(f"artifact_missing_ever={coverage_missing_artifact}")
    print(f"artifact_counted_ever={coverage_counted_ever_artifact}")
    print(f"approved_match={approved_count_tool == approved_count_artifact}")
    print(f"missing_match={coverage_missing_tool == coverage_missing_artifact}")
    print(f"counted_ever_match={coverage_counted_ever_tool == coverage_counted_ever_artifact}")

    if rag_hits_count <= 0:
        print("error: rag_search returned zero hits", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
