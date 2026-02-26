# RootFetch Strategy 2026 (Canonical Doctrine)

Status: Canonical  
Precedence: This document defines mission, terminology, phase goals, guardrails, and success conditions for 2026.

Derived documents:

- `docs/cadence_calendar_2026.md` (operational schedule)
- `docs/kpi_dashboard_spec.md` (measurement layer)

Derived documents must not redefine terms or alter phase goals independently.

## 1) Mission

RootFetch exists to be the verifiable structural chronicle of the namespace, built from DNS-visible evidence and immutable artifacts.

RootFetch is not:

- news
- opinion
- forecasting

RootFetch is:

- measurement
- documentation
- evidence

All outputs must reflect this distinction.

## 2) Operating Principles

1. Determinism over convenience
2. Evidence over narrative
3. Immutability over recomputation
4. Versioned contracts over silent change
5. Discipline over speed

These principles apply to product design, publication, integration, and governance.

## 3) Canonical Terms

The following terms are authoritative for all 2026 planning and reporting.

- `run`  
Immutable snapshot artifact set under `data/artifacts/runs/<run_id>/...`

- `compare link`  
`/compare?left=<run_id>&right=<run_id>`  
Used exclusively for run-to-run delta inspection.

- `structural brief`  
Scheduled monthly evidence report.

- `structural update`  
Unscheduled delta report published when trigger conditions are met.

- `regime bulletin`  
Update published within 24 hours of a regime flip or DVI band crossing.

- `concentration bulletin`  
Update published when Top10-share threshold breach occurs.

- `structural risk note`  
Quarterly summary of concentration, volatility baseline, and universe expansion.

- `meaningful delta`  
One or more of:
  - regime change
  - DVI band change
  - Top10-share shift beyond configured threshold
  - coverage universe change (approved TLD count shift)

- `artifact-linked`  
Includes:
  - run ID(s)
  - manifest hash(es)
  - compare link (where applicable)

Terminology must remain stable unless revised in this document.

## 4) Phase Architecture

### Phase 1 (0–6 weeks) — Structural Reference

Goal: Establish a recurring structural record.

Deliverables:

1. Monthly Structural Brief (fixed monthly cadence)
2. Structural Update upon meaningful delta
3. Brief archive page
4. Regime history continuity panel
5. RSS/JSON feed for briefs

Guardrails:

- No speculation
- No forecasting
- Every brief cites `run_id` and manifest hash
- Every delta report references `/compare`

Success condition:

- >= 2 structural briefs published
- >= 4 structural updates published
- Replay index >= 10 runs

### Phase 2 (6–12 weeks) — Integration Layer

Goal: Make RootFetch embedded.

Deliverables:

1. SDK + Agent + Notebook announcement
2. 2–3 integration templates
3. Time-to-first-verified-run < 5 minutes
4. “Verified by RootFetch” badge asset and usage guide

Guardrails:

- SDK remains a thin transport + verification wrapper
- No model interpretation logic inside SDK
- No caching behavior that alters determinism semantics

Success condition:

- SDK adoption measurable
- >= 1 third-party integration observed

### Phase 3 (12+ weeks) — Early-Warning Layer

Goal: Become a structural early-warning reference.

Deliverables:

1. Regime Change Bulletin template
2. Concentration Shift Bulletin template
3. Quarterly Structural Risk Notes

Guardrails:

- Bulletins are artifact-linked only
- No editorial framing
- Each bulletin includes run page link and compare link

Success condition:

- >= 3 regime bulletins published
- >= 1 external citation observed

## 5) Monetization Discipline

Monetization may be considered only when all conditions are true:

- >= 6 structural briefs published
- >= 20 runs archived
- >= 3 regime shifts documented
- SDK adoption observable

Until these conditions are satisfied:

- No paywalls
- No feature gating tied to core evidence surfaces

Monetization must follow structural dependence, not precede it.

## 6) Version Governance

- `model_version` changes must be documented and announced
- `methodology_version` increments must be logged with effective date
- No silent metric redefinition
- Historical archive remains immutable

Model evolution must preserve auditability.

## 7) Execution Mapping

Operational schedule: `docs/cadence_calendar_2026.md`  
Measurement mapping: `docs/kpi_dashboard_spec.md`

These documents operationalize this doctrine and must align strictly with it.
