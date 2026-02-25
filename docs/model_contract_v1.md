# RootFetch Model Contract v1

`model_version`: `rootfetch_model_v1`  
`methodology_version`: `2026-03-01`

This document defines the deterministic model used for DVI and structural regime classification.

## Scope

The contract stabilizes:

- `data/signals/latest.json` model fields
- replay state logic
- alert predicates that depend on model state
- AI summaries that reference regime or DVI

No silent formula changes are allowed. Any formula or threshold change requires a model version bump.

## DVI_v1

DVI_v1 is a bounded 0-100 score built from three normalized components:

- cross-sectional dispersion (`D_norm`)
- concentration shift (`C_norm`)
- anomaly clustering (`A_norm`)

### Inputs

For date `t` and TLD `i`:

- `d_i(t)`: delegated count
- `Δ_i(t) = d_i(t) - d_i(t-1)`
- `s_i(t) = d_i(t) / Σ_j d_j(t)`
- `HHI(t) = Σ_i s_i(t)^2`

### Component A: Cross-sectional Dispersion

- `z_i(t) = (Δ_i(t) - μ_Δ) / σ_Δ` (for that date across TLDs)
- `D(t) = mean_i(|z_i(t)|)`
- `D_norm = min(D(t) / D_max, 1.0)`

`D_max` is the empirical `p99` over the rolling calibration window (up to 180 dates), with a fixed floor to avoid short-history amplification.

### Component B: Concentration Shift

- `C(t) = |HHI(t) - HHI(t-1)|`
- `C_norm = min(C(t) / C_max, 1.0)`

`C_max` is the empirical `p99` over the rolling calibration window, with a fixed floor.

### Component C: Anomaly Clustering

- anomaly threshold: `|z_i(t)| > 2.5`
- `A(t) = anomaly_count / approved_tlds_count`
- `A_norm = min(A(t) / A_max, 1.0)`

`A_max` is the empirical `p99` over the rolling calibration window, with a fixed floor.

### Final Score

Weights:

- `w_D = 0.5`
- `w_C = 0.3`
- `w_A = 0.2`

Formula:

- `DVI_raw(t) = w_D * D_norm + w_C * C_norm + w_A * A_norm`
- `DVI_v1(t) = round(100 * DVI_raw(t), 1)`

Bands:

- `0 <= DVI < 25`: `stable`
- `25 <= DVI < 50`: `elevated`
- `50 <= DVI < 75`: `active`
- `75 <= DVI <= 100`: `turbulent`

## Regime_v1 State Machine

### States

- `STABLE`
- `ELEVATED`
- `ACTIVE`
- `CONSOLIDATING`
- `FRAGMENTING`
- `TURBULENT`

### Base Regime

Base regime is derived from DVI band.

### Override Rules

If `DVI < 50`:

- `CONSOLIDATING` when:
  - `delta_hhi > 0`
  - `top10_share_delta > 0.001`
- `FRAGMENTING` when:
  - `delta_hhi < 0`
  - `top10_share_delta < -0.001`

Otherwise regime remains base regime.

### Hysteresis and Minimum Duration

To prevent flapping:

- candidate transition must persist for `2` consecutive snapshots
- minimum active regime duration is `3` snapshots

### Regime Confidence

Confidence is a weighted agreement score in `[0.0, 1.0]`:

- DVI classification agreement: `0.5`
- HHI directional agreement: `0.3`
- Top10 share directional agreement: `0.2`

## Published Artifact Fields

`data/signals/latest.json` includes:

- `model_version`
- `methodology_version`
- `dvi` (legacy object, now sourced from model v1)
- `dvi_components`
- `dvi_band`
- `regime`
- `regime_confidence`
- `regime_inputs`
- `regime_base`
- `regime_candidate`
- `regime_duration_snapshots`
- `model_calibration`
- `model_effective_date_utc`

## Recalibration Policy

- normalization scales use rolling historical `p99` over the last 180 available dates
- deterministic fallback floors are fixed constants
- no adaptive/randomized behavior is allowed

## Versioning Policy

Any change to:

- weights
- thresholds
- hysteresis rules
- confidence scoring logic

requires:

- incrementing `model_version`
- updating this document
- updating regression fixtures/tests

## Reproducibility

The deterministic entrypoint is:

```bash
python compute_model_v1.py snapshot.json
```

Given identical input JSON, output must be identical across machines.
