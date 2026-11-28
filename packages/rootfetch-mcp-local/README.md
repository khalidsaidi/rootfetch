# RootFetch MCP server

Ask Claude, ChatGPT, Cursor or any MCP client about domain extensions (TLDs): how big .xyz is, who runs .bond, which extensions grew fastest this month, whether .top shows abuse signals. Data comes from [RootFetch](https://rootfetch.com), which counts registered domains in ~1,080 generic TLD zone files from ICANN every day.

Free, read-only, no account or API key.

## Hosted (recommended)

```
https://mcp.rootfetch.com/mcp
```

- **Claude (claude.ai / Desktop):** Settings, Connectors, Add custom connector, paste the URL.
- **Claude Code:** `claude mcp add --transport http rootfetch https://mcp.rootfetch.com/mcp`
- **ChatGPT:** enable developer mode, then add an app/connector with the URL.
- **Cursor / VS Code / Windsurf:**

```json
{ "mcpServers": { "rootfetch": { "url": "https://mcp.rootfetch.com/mcp" } } }
```

## Local (stdio)

```json
{
  "mcpServers": {
    "rootfetch": { "command": "npx", "args": ["-y", "@khalidsaidi/rootfetch-mcp"] }
  }
}
```

## Tools

| Tool | What it answers |
|---|---|
| `lookup_tld` | Size, rank, operator, launch date, growth, unusual jumps and a safety verdict for one extension. Accepts `.xyz`, `xyz` or `shop.example.xyz`. |
| `rank_tlds` | Largest, fastest growing, fastest shrinking or biggest gaining extensions. |
| `recent_jumps` | Sudden registration bursts (1,000+ domains and 5%+ within 21 days). |
| `compare_tlds` | 2 to 10 extensions side by side. |
| `tld_history` | Every recorded count for one extension. |

Not covered: `.com` and country codes such as `.uk` or `.de` (they don't publish zone files through ICANN CZDS).

Data license: CC BY 4.0. Code: MIT.
