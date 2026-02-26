# RootFetch Structural Brief — March 2026

Run ID: `20260225T235959Z_59aff28ff918_rootfetch_model_v1`  
Snapshot (UTC): `2026-02-25T23:59:59Z`  
Model Version: `rootfetch_model_v1`  
Methodology Version: `2026-03-01`

Run page:  
https://rootfetch.vercel.app/runs/20260225T235959Z_59aff28ff918_rootfetch_model_v1

Prior run in replay index: Not available (replay index currently contains 1 run).  
Comparison view will become available once a second run is published.

Manifest SHA256 (snapshot hash):  
`59aff28ff918bc42ff1d7595515ab431bd16597f142085f414458277f1de53a2`

## 1) Volatility (DVI)

DVI: `33.4`  
Band: `Elevated` (0–25 Stable, 25–50 Elevated, 50–75 Active, 75–100 Turbulent)

Delta vs prior snapshot date (`2026-02-24`): `+33.4`  
Note: prior snapshot is not present in replay index; delta reflects internal computation against previous ingestion date.

DVI components (normalized inputs to model):

- Dispersion: `0.051229`
- Concentration delta: `1.000000`
- Anomaly proportion: `0.041128`

`anomalies` array length: `0`

Interpretation:  
DVI falls within the Elevated band. No cross-sectional anomaly cluster was recorded in this run artifact.

## 2) Structural Regime

Regime: `STABLE`  
Confidence: `0.30`

Delta vs prior snapshot date (`2026-02-24`):

- Regime change: None (`STABLE` -> `STABLE`)
- Confidence change: `-0.70`

Regime inputs:

- Delta HHI: `-0.007082`
- Delta Top10 share: `+0.013430`
- Median delta: `0.000000`

Interpretation:  
No regime transition occurred in this snapshot window.

## 3) Concentration

Top 10 share: `69.5147%`  
Delta vs prior snapshot date (`2026-02-24`): `+1.3430` percentage points

HHI: `0.081853`  
Delta HHI: `-0.007082`

Interpretation:  
Model output regime remains `STABLE` for this run.

## 4) Movers (Artifact-Based)

Top movers by absolute delta:

- `.xyz` `+15,392` (Delta %: `+0.1912%`)
- `.app` `+1,893` (Delta %: `+0.1746%`)
- `.dev` `+980` (Delta %: `+0.1643%`)

Top movers by normalized anomaly (`|z| >= 2.5`):

- None (`anomalies` length = `0`)

## 5) Coverage Integrity

Approved TLDs: `851`  
Counted ever: `851`  
Missing ever: `0`  
Observed this snapshot (core + rolling): `68` (`core=3`, `rolling=65`)

Artifact verification:

- Manifest verification: `valid=true`
- `expected_count=8`
- `checked_count=8`
- `missing_files=[]`

Verification instructions:

JS:

```bash
node examples/verify-run.mjs 20260225T235959Z_59aff28ff918_rootfetch_model_v1
```

Python:

```bash
python3 examples/verify_run.py 20260225T235959Z_59aff28ff918_rootfetch_model_v1
```

Reproducibility notebook:  
`rootfetch-examples/reproducibility/reproducibility_v1.ipynb`

## 6) Evidence Links

Run page:  
https://rootfetch.vercel.app/runs/20260225T235959Z_59aff28ff918_rootfetch_model_v1

Replay archive:  
https://rootfetch.vercel.app/runs

Operational guarantees + methodology:  
https://rootfetch.vercel.app/methodology
