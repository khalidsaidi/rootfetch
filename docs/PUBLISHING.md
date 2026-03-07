# Publishing Checklist

This repository has two distinct publish surfaces:

- website/runtime deploy (`apps/web`)
- local MCP npm package (`packages/rootfetch-mcp-local`)

## MCP Registry

- `docs/registry/server.json` exists and is valid
- `mcpName` in package metadata matches registry name
- `remotes` includes canonical streamable HTTP endpoint (`https://rootfetch.com/mcp`)

## NPM Package

- package path: `packages/rootfetch-mcp-local`
- package name: `@khalidsaidi/rootfetch-mcp`
- published artifact includes `dist/`, `README.md`, and `server.json`

Pre-publish sanity:

```bash
cd packages/rootfetch-mcp-local
npm install
npm run build
npm pack
```

Publish:

```bash
cd packages/rootfetch-mcp-local
npm publish --access public
```

## MCP Registry Publish

From `packages/rootfetch-mcp-local`:

```bash
../bin/mcp-publisher login github
../bin/mcp-publisher publish
```

## Post-publish Verification

- npm package resolves: `npx -y @khalidsaidi/rootfetch-mcp@latest`
- MCP endpoint works: `https://rootfetch.com/mcp`
- health/ready endpoints return expected status:
  - `https://rootfetch.com/mcp/health`
  - `https://rootfetch.com/mcp/readyz`
- AIR/OpenAPI/plugin endpoints are live under `rootfetch.com` and `.well-known/*`
