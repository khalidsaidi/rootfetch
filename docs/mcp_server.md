# RootFetch MCP Server

RootFetch includes a read-only MCP server exposing committed artifacts from
`data/` and `docs/`.

## Guarantees

- Read-only surface (no CZDS auth, no zone downloads, no writes to product data)
- No secrets exposed
- Serves only local aggregate artifacts and docs

## Run Locally (STDIO)

```bash
rootfetch mcp serve --transport stdio
```

Important: when using STDIO transport, logs must go to stderr only. RootFetch
MCP server is configured accordingly to avoid JSON-RPC corruption.

## Run Over Streamable HTTP

```bash
rootfetch mcp serve --transport streamable-http --port 8000
```

## Inspect with MCP Inspector

```bash
npx -y @modelcontextprotocol/inspector
```

Then connect to the RootFetch server command above.

## Resource URIs

- `rootfetch://signals/latest`
- `rootfetch://growth_trends`
- `rootfetch://daily_counts/{date}`
- `rootfetch://approved_tlds/{date}`
- `rootfetch://digest/latest`
- `rootfetch://digest/{date}`
- `rootfetch://docs/metrics_spec`
- `rootfetch://docs/signal_spec`
- `rootfetch://signals/top_movers/{date}`
- `rootfetch://signals/anomalies/{date}`
- `rootfetch://signals/sector_snapshot/{date}`

## Tools

- `rootfetch_health()`
- `rootfetch_get_latest()`
- `rootfetch_get_tld_timeseries(tld, days=30)`
- `rootfetch_top_movers(date, by="abs"|"pct", limit=20)`
- `rootfetch_anomalies(date, limit=50)`
- `rag_search(query, k=8, filters=None)`
- `rag_get_chunk(id)`

## Prompts

- `rootfetch_daily_brief(date="latest")`
- `rootfetch_investigate_tld(tld, days=30)`
