# Model Version Evolution Playbook

Status: Governance  
Scope: Applies when introducing a new `model_version` (for example, `rootfetch_model_v2`).

## 1) Purpose

This protocol ensures model evolution does not:

- rewrite historical meaning
- create silent metric drift
- break artifact verifiability
- compromise comparative continuity
- introduce non-reproducible outputs

Model evolution must preserve auditability.
Model evolution is permitted only when stability of meaning can be preserved through versioning.

## 2) Permitted Triggers for Model Evolution

A new `model_version` may be introduced only when at least one condition is true:

- mathematical formula change (`DVI` components, weights, normalization logic)
- regime state machine change (thresholds, hysteresis, confidence logic)
- input schema expansion or structural change
- bug correction that materially affects computed outputs
- calibration window redefinition

Prohibited:

- cosmetic renaming
- performance optimizations without output change
- undocumented threshold tweaks
- silent weight changes

## 3) Pre-Release Requirements

Before introducing `model_version_vX`, all items below are mandatory.

### A) Formal Diff Documentation

Create:

- `docs/model_version_vX_diff.md`

Must include:

- exact mathematical differences
- threshold changes
- calibration window changes
- expected directional impact
- non-backward-compatible behaviors

### B) Backward Compatibility Audit

For at least 3 historical runs:

1. recompute using old model
2. recompute using new model
3. produce a comparison table containing:
   - DVI old -> new
   - regime old -> new
   - confidence delta

This table must be published internally before rollout.

### C) Determinism Test

For identical inputs:

- new model must produce identical output across machines
- regression tests must be updated
- reproducibility notebook must be updated

## 4) Version Transition Protocol

When deploying a new `model_version`:

1. publish final run under old model
2. publish first run under new model
3. publish mandatory transition compare snapshot between the final old-model run and the first new-model run
4. issue Model Version Transition Notice (separate from Structural Brief)

Temporal invariant (required):

- `old_model_final_run.publish_commit_timestamp_utc < new_model_first_run.publish_commit_timestamp_utc`
- if violated, transition is invalid

Transition notice must include:

- old model version
- new model version
- run IDs for both
- compare link
- explicit statement: `Model logic changed.`

## 5) Comparative Integrity Rules

- `/compare` may compare runs across model versions.
- Bulletin must explicitly state model transition when versions differ.
- If regime or DVI band change is attributable solely to model logic transition, bulletin must include explicit line: `Change attributed to model_version transition.`
- Regime flip caused by model change must be labeled `model-induced`.
- Structural Briefs must not aggregate data across different `model_version` values without explicit disclosure.

Prohibited:

- implying structural shift when change is caused by model logic transition.

## 6) Archive Integrity Rules

- Historical runs remain immutable.
- Historical outputs are not recomputed retroactively.
- Archive reflects outputs as computed at publish time.

If recalculation is required:

- publish a new run under the new model
- do not overwrite old artifacts

## 7) Governance Safeguards

Invariant:

- if `model_version_left != model_version_right`, bulletin must include a version disclosure block.
- if `model_version_left != model_version_right`, KPI log must set `model_transition=true`.
- KPI log must include `model_version_old`, `model_version_new`, and `transition_notice_published=true`.

## 8) Rollback Protocol

If new model produces incorrect outputs:

1. halt publication
2. revert to previous `model_version`
3. publish correction note referencing affected run IDs

Preservation rule:

- preserve invalidated artifacts
- label invalidated artifacts as `superseded`
- no deletion
- affected run IDs must remain accessible and clearly labeled as `superseded`; no artifact removal is permitted

## 9) Success Criteria for Safe Model Evolution

- no silent metric drift
- no unexplained regime shifts
- all model changes documented
- all version transitions artifact-linked
- reproducibility notebook updated

This protocol prevents the highest-risk failure class: quiet changes to model meaning.
