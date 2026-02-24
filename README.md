# RootFetch

RootFetch is a daily CZDS zone analytics engine that will publish safe, aggregated
TLD trend metrics and product signals.

Status: repository bootstrapped, planning documents committed, implementation not
started yet.

## Planned Scope

1. Daily CZDS auth + approved-link discovery (dynamic, no hardcoded TLD list)
2. Streaming zone parsing into aggregate counts (no raw zone storage)
3. Growth trends and product signals (movers, volatility, anomalies, sectors)
4. Read-only MCP server over committed outputs
5. RAG index over docs and daily digests

## Safety/Compliance

- Never commit credentials, tokens, MFA secrets, or `.env` files.
- Never commit raw zone files/content.
- Treat download URLs as sensitive; keep full URLs only in `.ai/` artifacts.
- Commit only safe aggregates under `data/` plus docs/code.

## Planning Docs

- `docs/work_plan.md`
- `.ai/execution_plan.md`
- `.ai/README.md`
