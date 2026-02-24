# RootFetch

RootFetch is a CZDS trend engine that measures DNS-visible delegated domain activity
from zone snapshots and publishes safe aggregate artifacts for product surfaces.

## Operating Model

- Ingestion runs on your machine (local runner), not on Vercel.
- Vercel serves read-only precomputed artifacts from the repo.
- Hybrid cadence:
  - Core set processed daily
  - Long tail processed on deterministic rolling shards

## Primary Metric

- `count_ns_sld`: unique second-level owners with at least one `NS` record.

This is a delegation footprint proxy, not total registrations.

## Safety

- Never commit credentials/tokens/MFA seeds.
- Never commit `.env` files.
- Never commit raw zone files (`*.gz`, `*.zone`, `*.txt.gz`).
- Commit only safe aggregates under `data/` and code/docs.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Set local env vars (or use local `.env`):

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- optional `CZDS_TOTP_SECRET`

## CLI

```bash
rootfetch auth-check
rootfetch discover
rootfetch run-hybrid
rootfetch run-hybrid --dry-run
rootfetch compute-signals --date YYYY-MM-DD
rootfetch rag build
rootfetch rag build-static
rootfetch rag search "count_ns_sld"
rootfetch mcp serve --transport stdio
```

## Local Automation

Primary daily entrypoint:

```bash
./scripts/local_run_hybrid.sh
```

See scheduler setups in [docs/local_runner.md](docs/local_runner.md).

## Outputs

- `data/approved_tlds/latest.json`
- `data/daily_counts/<YYYY-MM-DD>.csv`
- `data/growth_trends.csv`
- `data/signals/*`
- `data/digests/*`
- `data/rag/rag_chunks.json`
- `data/rag/rag_meta.json`

## Docs

- Metrics: [docs/metrics_spec.md](docs/metrics_spec.md)
- Signals: [docs/signal_spec.md](docs/signal_spec.md)
- MCP server: [docs/mcp_server.md](docs/mcp_server.md)
- RAG: [docs/rag.md](docs/rag.md)
- Local runner: [docs/local_runner.md](docs/local_runner.md)

## GitHub Actions

- `.github/workflows/rootfetch_daily.yml` runs on `self-hosted` only.
- `.github/workflows/release.yml` runs CI tests/build checks.
- `.github/workflows/vercel_deploy.yml` deploys dashboard on safe artifact/code changes.
