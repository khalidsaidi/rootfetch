# RootFetch

RootFetch is a CZDS trend engine that measures DNS-visible delegated domain activity
from zone snapshots and publishes safe aggregate artifacts for product surfaces.

## Operating Model

- Ingestion runs on your machine (local runner), not on Vercel.
- Vercel serves read-only precomputed artifacts from the repo.
- Two ingestion modes:
  - Day-1 baseline: ingest all approved CZDS TLDs in one resumable run.
  - Daily hybrid (after baseline completion): core set daily + deterministic rolling long tail.

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

Quick start:

```bash
cp .env.example .env
```

Optional local MCP auth for step-9 live checks (keep this local-only, never commit):

```bash
cat > .env.mcp <<'EOF'
ROOTFETCH_MCP_TOKEN=replace_with_vercel_mcp_token
ROOTFETCH_MCP_ORIGIN=https://rootfetch.vercel.app
ROOTFETCH_MCP_URL=https://rootfetch.vercel.app/api/mcp
EOF
chmod 600 .env.mcp
```

## CLI

```bash
rootfetch auth-check
rootfetch discover
rootfetch run-baseline --dry-run
rootfetch run-baseline --resume
rootfetch baseline-status
rootfetch run-hybrid
rootfetch run-hybrid --dry-run
rootfetch compute-signals --date YYYY-MM-DD
python compute_model_v1.py snapshot.json
rootfetch rag build
rootfetch rag build-static
rootfetch rag search "count_ns_sld"
rootfetch mcp serve --transport stdio
rootfetch alerts run --date YYYY-MM-DD
rootfetch alerts run --date YYYY-MM-DD --recover-corrupt-state
rootfetch publish prepare --date YYYY-MM-DD --out-dir .ai/publish/latest
rootfetch publish run --source-dir .ai/publish/latest --artifacts-root data/artifacts --model-version rootfetch_model_v1 --snapshot-ts-utc 2026-02-25T23:15:01Z
```

## Local Automation

Primary daily entrypoint:

```bash
./scripts/local_run_hybrid.sh
```

Full retest entrypoint (includes MCP checks when `ROOTFETCH_MCP_TOKEN` is set):

```bash
./scripts/retest_new_approvals.sh
```

The script auto-switches:

1. runs `rootfetch discover`
2. if baseline is incomplete, repeatedly runs `rootfetch run-baseline --resume` until 100% coverage
3. once baseline is complete, runs `rootfetch run-hybrid`
4. rebuilds static RAG + commits safe artifacts only

See scheduler setups in [docs/local_runner.md](docs/local_runner.md).

## Outputs

- `data/approved_tlds/latest.json`
- `data/daily_counts/<YYYY-MM-DD>.csv`
- `data/growth_trends.csv`
- `data/signals/*`
- `data/digests/*`
- `data/rag/rag_chunks.json`
- `data/rag/rag_meta.json`
- `data/artifacts/latest.json`
- `data/artifacts/replay/index.json`
- `data/artifacts/runs/<run_id>/*`
- `data/state/baseline_complete.json` (written once baseline reaches 100%)

## Docs

- Metrics: [docs/metrics_spec.md](docs/metrics_spec.md)
- Signals: [docs/signal_spec.md](docs/signal_spec.md)
- Model contract v1: [docs/model_contract_v1.md](docs/model_contract_v1.md)
- Artifact + caching contract: [docs/caching_and_artifacts.md](docs/caching_and_artifacts.md)
- Operational guarantees: [docs/operational_guarantees.md](docs/operational_guarantees.md)
- MCP server: [docs/mcp_server.md](docs/mcp_server.md)
- RAG: [docs/rag.md](docs/rag.md)
- Local runner: [docs/local_runner.md](docs/local_runner.md)

## GitHub Actions

- `.github/workflows/rootfetch_daily.yml` runs on `self-hosted` only.
- `.github/workflows/release.yml` runs CI tests/build checks.
- `.github/workflows/vercel_deploy.yml` deploys dashboard on safe artifact/code changes.
