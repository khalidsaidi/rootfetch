# RootFetch MCP Server

RootFetch exposes read-only MCP surfaces from committed artifacts.

## Deployment Modes

1. Python MCP server (`rootfetch mcp serve`) for local workflows.
2. Hosted MCP route at `/mcp` for read-only public access.

No mode performs CZDS auth or zone downloads.

## Hosted MCP (Pattern 1)

Pattern in use: static artifact sync into web `public/rootfetch/*` at build time.

MCP reads from immutable artifact paths:

- `artifacts/latest.json`
- `artifacts/replay/index.json`
- `artifacts/runs/<run_id>/manifest.json`
- `artifacts/runs/<run_id>/model_latest.json`
- `artifacts/runs/<run_id>/coverage_latest.json`
- `artifacts/runs/<run_id>/signals_latest.json`

## Security

Hosted `/mcp` is public and rate-limited:

- no auth token required
- token bucket per IP (default: 60 requests/minute, burst 20)
- returns `429` + `Retry-After` when limited
- artifact allowlist only (no arbitrary path reads, no recompute)
- optional shared limiter backend via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

Operational endpoints:

- `GET /mcp/health`
- `GET /mcp/healthz`
- `GET /mcp/readyz`
- `GET /mcp/live` (public anonymized usage/event view)
- `GET /api/mcp/public-stats?days=7` (public anonymized stats)
- `GET /api/mcp/public-events?limit=30` (public anonymized recent event classes)
- `GET /api/mcp/stats?days=7` (admin-protected)
- `GET /api/mcp/events?limit=50` (admin-protected)
- `GET /admin/usage` (human usage dashboard, admin-protected)
- `GET /admin/agent-events` (human event dashboard, admin-protected)
- `GET /docs/hosting/mcp/` (hosting compatibility landing)
- `GET /.well-known/glama.json` (connector metadata)

Protocol notes:

- `POST /mcp` supports JSON-RPC `initialize`, `tools/list`, and `tools/call`
- clients should send `Accept: application/json, text/event-stream`

## MCP Usage Auth + Telemetry

- Admin protection uses HTTP Basic Auth via middleware:
  - username: `ADMIN_DASH_USER` (fallback `ROOTFETCH_ADMIN_USER`, default `admin`)
  - password: `ADMIN_DASH_PASS` (fallback `ROOTFETCH_ADMIN_PASS`, then `ROOTFETCH_MCP_TOKEN`)
- MCP usage telemetry is persisted in a dedicated GCP backend service (Cloud Run + Firestore).
- RootFetch web runtime forwards telemetry through:
  - `ROOTFETCH_MCP_TELEMETRY_BACKEND_URL`
  - `ROOTFETCH_MCP_TELEMETRY_BACKEND_TOKEN`

- Admin auth env:
  - `ADMIN_DASH_USER` (default `admin`)
  - `ADMIN_DASH_PASS` (required)

## MCP Behavioral Contract

- read-only surface only
- immutable artifact-backed responses only
- no compute or signal recomputation in MCP handlers
- bounded response payload size (`ROOTFETCH_MCP_MAX_PAYLOAD_BYTES`, default 5 MB)
- rate limits enforced on all MCP methods

## Hosted MCP Tools

- `rootfetch.latest`
- `rootfetch.replay_index`
- `rootfetch.run_manifest`
- `rootfetch.run_bundle`
- `rootfetch.compare_link`

Tool payloads are returned as JSON text content.

## Local MCP Package

Published local stdio bridge package:

- npm: `@khalidsaidi/rootfetch-mcp`
- command: `npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp`
- registry metadata: `docs/registry/server.json`

## Python MCP Resources/Tools

Resources:

- `rootfetch://signals/latest`
- `rootfetch://growth_trends`
- `rootfetch://daily_counts/{date}`
- `rootfetch://approved_tlds/{date}`
- `rootfetch://digest/{date}` and `rootfetch://digest/latest`
- `rootfetch://docs/{doc_name}`

Tools:

- `rootfetch_health`, `rootfetch_get_latest`, `rootfetch_get_tld_timeseries`
- `rootfetch_top_movers`, `rootfetch_anomalies`
- `rag_search`, `rag_get_chunk`

## Local Run

STDIO:

```bash
rootfetch mcp serve --transport stdio
```

Streamable HTTP:

```bash
rootfetch mcp serve --transport streamable-http --port 8000
```

When using STDIO transport, logs must stay off stdout.
