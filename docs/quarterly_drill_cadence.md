# Quarterly Drill Cadence

Status: Governance  
Scope: Defines recurring validation drills for RootFetch operational integrity.

Derived from:

- `docs/strategy_2026.md`
- `docs/regime_flip_playbook.md`
- `docs/model_version_evolution_playbook.md`

Purpose: Ensure governance mechanisms remain executable under pressure.

## 1) Drill Philosophy

Drills exist to validate:

- detection correctness
- artifact-chain integrity
- publication discipline
- temporal invariants
- version governance
- halt behavior under corruption

Drills are required even when no live events occur.

Governance must be exercised, not assumed.

## 2) Quarterly Drill Requirements

Frequency: once per calendar quarter (minimum)  
Recommended timing: first month of each quarter

Each quarter must include:

### A) Regime Flip Drill

Simulated regime change between immutable runs.

Must validate:

- trigger detection
- artifact validation checklist
- bulletin draft compliance
- SLA timing enforcement
- KPI logging
- drift audit

Reference: `docs/regime_flip_playbook.md`

### B) Model Version Evolution Drill

Simulated model transition (`vX -> vY`).

Must validate:

- diff documentation existence
- backward compatibility audit process
- transition compare snapshot
- version disclosure block enforcement
- KPI `model_transition` logging
- temporal invariant enforcement

Reference: `docs/model_version_evolution_playbook.md`

### C) Artifact Corruption Drill

Simulated manifest mismatch or file corruption.

Must validate:

- `verifyManifest` failure detection
- compare degraded-state handling
- bulletin halt enforcement
- no publication allowed
- incident log entry created (location must be documented, for example `docs/incidents/` or `logs/`)

Reference: `docs/regime_flip_playbook.md` (Artifact Validation Checklist section)

## 3) Drill Execution Rules

- all drills must use stored immutable artifacts or controlled synthetic fixtures
- no drill may bypass SDK verification
- drill reports must be documented and retained in repository
- each drill must produce a `PASS` or `FAIL` status

Failure handling:

- `FAIL` must result in governance hardening before next quarter

## 4) Reporting Requirements

Each drill must generate:

- simulation metadata
- checklist execution results
- `PASS/FAIL` status
- identified weakest link
- recommended hardening (if any)

Drill reports must not contain editorial narrative.

## 5) KPI Logging

Each quarterly drill must log:

- drill type
- date executed
- `PASS/FAIL`
- SLA compliance (if applicable)
- invariants violated (if any)

Drill execution counts toward governance KPIs under Phase 3.

## 6) Governance Invariants

Quarterly drills must confirm:

- artifact immutability remains intact
- replay index integrity maintained
- model version discipline preserved
- no silent drift detected
- all governance documents remain consistent
- `publish_commit_timestamp_utc <= detection_timestamp_utc <= publication_timestamp_utc` remains enforced (else `SLA=INVALID`)

If any invariant fails, immediate governance review is required.

## 7) Non-Negotiable Rule

Drills must occur even in periods of structural stability.

Absence of live regime changes does not suspend governance testing.
