# RootFetch Work Plan

Date: 2026-02-24 (UTC)

This repository is intentionally in planning mode. No production code has been
implemented in this step.

## Objective

Ship a monorepo that includes:

1. RootFetch daily CZDS aggregate pipeline
2. Read-only RootFetch MCP server over committed artifacts
3. RAG subsystem for docs + digest retrieval

## Phased Execution

## Phase 1: Bootstrap + Safety

- Finalize repository structure.
- Enforce `.gitignore` policy for credentials, tokens, raw zones, and internal
  `.ai/` runtime artifacts.
- Add user-facing specs and internal execution plan.

## Phase 2: Auth + Discovery

- Implement ICANN Account API token acquisition + safe cache.
- Add approved download link discovery from CZDS API.
- Store full link snapshots only in `.ai/` and sanitized TLD-only snapshots in
  `data/approved_tlds/`.

## Phase 3: Counting Pipeline

- Implement streaming zone fetch + parse.
- Compute primary metric (`count_ns_sld`) and secondary metrics
  (`count_ds_sld`, `count_glue_hosts`, `count_ns_rr`).
- Write daily count outputs and append growth trends.

## Phase 4: Product Signals

- Generate top movers, volatility, anomalies, sector snapshots, and
  `latest.json`.
- Produce deterministic daily markdown digest for human-readable summaries.

## Phase 5: MCP + RAG

- Add read-only MCP resources, tools, and prompts.
- Implement RAG index with SQLite FTS5 baseline.
- Add optional embeddings backend behind environment flag.

## Phase 6: Automation + Validation

- Add daily GitHub Actions run and manual trigger.
- Add smoke tests and unit tests for metrics, signals, MCP, and RAG.
- Confirm commit policy excludes secrets and raw zone artifacts.

## Definition of Done

- Pipeline produces committed aggregate outputs only.
- MCP server is read-only and serves resources/tools/prompts from safe data.
- RAG search returns relevant results from docs and digests.
- CI/workflow automation runs daily and commits only safe files.
