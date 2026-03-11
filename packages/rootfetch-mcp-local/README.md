# RootFetch MCP (Local)

Local stdio MCP bridge for RootFetch immutable artifact tools.

This package is for MCP hosts that prefer a local stdio process while still using the canonical hosted RootFetch MCP endpoint.

## Quick start

```bash
npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp
```

Default remote endpoint:

- `https://rootfetch.com/mcp`

Override:

```bash
ROOTFETCH_MCP_URL=https://rootfetch.com/mcp npx -y @khalidsaidi/rootfetch-mcp@latest rootfetch-mcp
```

## Claude Desktop config

```json
{
  "mcpServers": {
    "rootfetch": {
      "command": "npx",
      "args": ["-y", "@khalidsaidi/rootfetch-mcp@latest", "rootfetch-mcp"],
      "env": {
        "ROOTFETCH_MCP_URL": "https://rootfetch.com/mcp"
      }
    }
  }
}
```

## Remote MCP (no install)

```bash
claude mcp add --transport http rootfetch https://rootfetch.com/mcp
```

## Tools

- `rootfetch.outcome.current_state`
- `rootfetch.outcome.run_delta`
- `rootfetch.outcome.tld_spotlight`
- `rootfetch.outcome.alert_candidates`
- `rootfetch.latest`
- `rootfetch.replay_index`
- `rootfetch.run_manifest`
- `rootfetch.run_bundle`
- `rootfetch.compare_link`

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ROOTFETCH_MCP_URL` | No | Remote MCP endpoint (default: `https://rootfetch.com/mcp`) |
| `ROOTFETCH_MCP_TIMEOUT_MS` | No | HTTP timeout for forwarded calls (default: `30000`) |

## Links

- Agent guide: `https://rootfetch.com/agents`
- MCP docs: `https://rootfetch.com/docs/mcp`
- First-call validator: `https://rootfetch.com/api/mcp/first-call`
- Public endpoints: `https://rootfetch.com/mcp`, `/mcp/health`, `/mcp/readyz`
- AIR: `https://rootfetch.com/.well-known/air.json`
