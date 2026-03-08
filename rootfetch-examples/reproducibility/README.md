# RootFetch Reproducibility Notebook (v1)

This notebook is a public proof artifact:

1. Resolves a concrete run ID.
2. Verifies `manifest.json` SHA256 hashes for run files.
3. Loads run artifacts (`model`, `coverage`, `signals`).
4. Recomputes `DVI_v1` + `Regime_v1` from public `growth_trends.csv`.
5. Emits a short verification report suitable for citation.

## Run

From repo root:

```bash
jupyter notebook rootfetch-examples/reproducibility/reproducibility_v1.ipynb
```

Optional environment variables:

- `ROOTFETCH_BASE_URL` (default: `https://rootfetch.com`)
- `ROOTFETCH_RUN_ID` (default: resolve from latest pointer)
- `ROOTFETCH_TIMEOUT` (default: `30` seconds)

No API keys are required.

