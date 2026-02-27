# RootFetch

Delegation intelligence from DNS-visible evidence, not marketing claims.

RootFetch computes structural movement in the global namespace from CZDS zone snapshots. It runs locally (no raw zone publishing), produces versioned model outputs (DVI + regime classification), and publishes immutable read-only artifacts for analysis, replay, alerting, and AI agents.

## Core Outputs

- `DVI_v1`: bounded 0-100 volatility index (dispersion + concentration delta + anomaly clustering)
- `Regime_v1`: state machine with thresholds + hysteresis + minimum duration + confidence score
- Immutable artifacts: `data/artifacts/runs/<run_id>/...` with `manifest.json` (size + sha256)

## Guarantees

- Immutable run artifacts (cacheable for 1 year)
- Atomic `latest.json` pointer (no mixed reads)
- Auditable alert delivery (at-least-once + durable dedup + dead-letter)
- Read-only serving on Vercel

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

Set local env vars with a local credential file (`.env.czds` recommended; `.env` remains legacy-compatible):

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- optional `CZDS_TOTP_SECRET`

Quick start:

```bash
cp .env.example .env.czds
chmod 600 .env.czds
rootfetch auth-check
```

Optional local MCP endpoint override for step-9 live checks (keep this local-only, never commit):

```bash
cat > .env.mcp <<'EOF'
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

Full retest entrypoint (includes MCP checks when MCP URL is configured):

```bash
./scripts/retest_new_approvals.sh
```

Both run scripts load local env files in this order: `.env.czds` -> `.env` -> `.env.mcp`.

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
- CZDS credentials: [docs/czds_credentials.md](docs/czds_credentials.md)
- Local runner: [docs/local_runner.md](docs/local_runner.md)

RootFetch is a read-only intelligence layer. If it is not in the artifacts, it did not happen.

## GitHub Actions

- `.github/workflows/rootfetch_daily.yml` runs on `self-hosted` only.
- `.github/workflows/release.yml` runs CI tests/build checks.
- `.github/workflows/vercel_deploy.yml` deploys dashboard on safe artifact/code changes.
