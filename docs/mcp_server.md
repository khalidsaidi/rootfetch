# RootFetch MCP Server

RootFetch exposes read-only MCP surfaces from committed artifacts.

## Deployment Modes

1. Python MCP server (`rootfetch mcp serve`) for local workflows.
2. Vercel MCP route at `/api/mcp` for hosted read-only access.

No mode performs CZDS auth or zone downloads.

## Vercel MCP (Pattern 1)

Pattern in use: static artifact sync into web `public/rootfetch/*` at build time.

MCP reads from immutable artifact paths:

- `artifacts/latest.json`
- `artifacts/replay/index.json`
- `artifacts/runs/<run_id>/manifest.json`
- `artifacts/runs/<run_id>/model_latest.json`
- `artifacts/runs/<run_id>/coverage_latest.json`
- `artifacts/runs/<run_id>/signals_latest.json`

## Security

Vercel `/api/mcp` is public and rate-limited:

- no auth token required
- token bucket per IP (default: 60 requests/minute, burst 20)
- returns `429` + `Retry-After` when limited
- artifact allowlist only (no arbitrary path reads, no recompute)
- optional shared limiter backend via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

## MCP Behavioral Contract

- read-only surface only
- immutable artifact-backed responses only
- no compute or signal recomputation in MCP handlers
- bounded response payload size (`ROOTFETCH_MCP_MAX_PAYLOAD_BYTES`, default 5 MB)
- rate limits enforced on all MCP methods

## Vercel MCP Tools

- `rootfetch.latest`
- `rootfetch.replay_index`
- `rootfetch.run_manifest`
- `rootfetch.run_bundle`
- `rootfetch.compare_link`

Tool payloads are returned as JSON text content.

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
