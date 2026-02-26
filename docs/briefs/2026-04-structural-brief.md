# RootFetch Structural Brief — April 2026

Run ID: `<RUN_ID>`  
Snapshot (UTC): `<SNAPSHOT_UTC>`  
Model Version: `<MODEL_VERSION>`  
Methodology Version: `<METHODOLOGY_VERSION>`

Run page:  
`https://rootfetch.vercel.app/runs/<RUN_ID>`

Compare view (if prior run exists):  
`https://rootfetch.vercel.app/compare?left=<LEFT_RUN_ID>&right=<RUN_ID>`

Manifest SHA256 (snapshot hash):  
`<SNAPSHOT_HASH>`

## 1) Volatility (DVI)

DVI: `<DVI_VALUE>`  
Band: `<DVI_BAND>`

Delta vs prior snapshot: `<DVI_DELTA>`

DVI components (normalized):

- Dispersion: `<DISPERSION_NORM>`
- Concentration delta: `<CONCENTRATION_NORM>`
- Anomaly proportion: `<ANOMALY_NORM>`

## 2) Structural Regime

Regime: `<REGIME>`  
Confidence: `<REGIME_CONFIDENCE>`

Delta vs prior snapshot:

- Regime change: `<REGIME_LEFT> -> <REGIME_RIGHT>`
- Confidence change: `<CONFIDENCE_DELTA>`

Regime inputs:

- Delta HHI: `<DELTA_HHI>`
- Delta Top10 share: `<DELTA_TOP10_SHARE>`
- Median delta: `<MEDIAN_DELTA>`

## 3) Concentration

Top 10 share: `<TOP10_SHARE>`  
Delta: `<TOP10_SHARE_DELTA>`

HHI: `<HHI>`  
Delta HHI: `<DELTA_HHI>`

## 4) Movers (Artifact-Based)

Top movers by absolute delta:

- `<TLD_1>` `<DELTA_ABS_1>` (`<DELTA_PCT_1>`)
- `<TLD_2>` `<DELTA_ABS_2>` (`<DELTA_PCT_2>`)
- `<TLD_3>` `<DELTA_ABS_3>` (`<DELTA_PCT_3>`)

Top movers by anomaly (`|z| >= 2.5`):

- `<ANOMALY_SUMMARY_OR_NONE>`

## 5) Coverage Integrity

Approved TLDs: `<APPROVED_TLDS_COUNT>`  
Counted ever: `<COUNTED_EVER_COUNT>`  
Missing ever: `<MISSING_EVER_COUNT>`  
Observed this snapshot (core + rolling): `<OBSERVED_TODAY_COUNT>` (`core=<CORE_COUNT>`, `rolling=<ROLLING_COUNT>`)

Artifact verification:

- Manifest verification: `<VALID_BOOL>`
- `expected_count=<EXPECTED_COUNT>`
- `checked_count=<CHECKED_COUNT>`
- `missing_files=<MISSING_FILES>`

Verification instructions:

```bash
node examples/verify-run.mjs <RUN_ID>
python3 examples/verify_run.py <RUN_ID>
```

Reproducibility notebook:  
`rootfetch-examples/reproducibility/reproducibility_v1.ipynb`

## 6) Evidence Links

Run page:  
`https://rootfetch.vercel.app/runs/<RUN_ID>`

Replay archive:  
`https://rootfetch.vercel.app/runs`

Operational guarantees + methodology:  
`https://rootfetch.vercel.app/methodology`
