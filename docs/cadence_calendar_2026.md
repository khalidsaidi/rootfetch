# RootFetch Cadence Calendar 2026

Status: Derived from `docs/strategy_2026.md`  
Purpose: Operational scheduling of defined deliverables.

All cadence decisions derive from Phase definitions in the canonical strategy.

## 1) Monthly Structural Brief

Frequency: Once per calendar month  
Timing: First full week of month  
Input: Most recent immutable run at time of publication

Must include:

- `run_id`
- manifest hash
- DVI + band
- regime + confidence
- coverage summary
- compare link (if prior run exists)

Must not include:

- forecasts
- interpretation beyond artifact evidence

Strategy reference: `strategy_2026.md` -> Phase 1

## 2) Structural Updates (Conditional)

Triggered by `meaningful delta` as defined in strategy.
Detection source: comparison between consecutive immutable runs via `/compare` or equivalent artifact-only diff logic.

Publish within 24 hours of detection.

Must include:

- left `run_id`
- right `run_id`
- compare link
- delta summary
- manifest hashes

Strategy reference: `strategy_2026.md` -> Phase 1

## 3) Regime Bulletins (Conditional)

Triggered by:

- regime flip
- DVI band crossing

Publish within 24 hours.

No editorial framing.

Strategy reference: `strategy_2026.md` -> Phase 3

## 4) Concentration Bulletins (Conditional)

Triggered by:

- Top10-share threshold breach

Threshold value must be documented and versioned.

Publish within 24 hours.

Strategy reference: `strategy_2026.md` -> Phase 3

## 5) Quarterly Structural Risk Notes

Frequency: Quarterly

Content limited to:

- concentration trajectory
- volatility baseline trend
- universe expansion rate

Must cite runs only.

Strategy reference: `strategy_2026.md` -> Phase 3

## 6) No-Publication Condition

If no meaningful delta occurs within a month:

- publish monthly brief regardless

Absence of change is documented.

## 7) Mapping Integrity

- Goals and terms source: `docs/strategy_2026.md`
- Metrics source: `docs/kpi_dashboard_spec.md`

This document defines timing only.
