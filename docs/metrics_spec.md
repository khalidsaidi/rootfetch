# RootFetch Metrics Spec

RootFetch reports zone-derived delegation metrics, not total registration counts.

## Primary Metric

### `count_ns_sld`

Definition:

- For TLD `tld` on date `D`, count unique second-level owner names with at least one `NS` record.
- Include only SLD depth (`example.tld`).
- Exclude apex (`tld`) and deeper labels (`a.example.tld`).

Interpretation:

- Proxy for DNS-visible active delegated domains.

## Secondary Metrics

### `count_ds_sld`

- Unique SLD owners with at least one `DS` record.

### `count_glue_hosts`

- Unique owner hostnames under the TLD with `A`/`AAAA` records.

### `count_ns_rr`

- Raw NS RR line count (not unique owner count).

### Operational

- `bytes_downloaded`
- `fetch_seconds`
- `status`
- `error`

## Hybrid Trend Fields

In `data/growth_trends.csv`, each row now includes:

- `prev_date_utc`: previous observed date for that TLD
- `days_since_prev`: difference between `date_utc` and `prev_date_utc`
- `cadence`: `core` or `rolling` (or legacy `daily`)

Deltas are computed against `prev_date_utc`:

- `delta_abs = count - prev_count`
- `delta_pct = delta_abs / prev_count` (blank if previous missing/0)

This prevents misleading day-over-day comparisons for rolling rows.

## Data Quality

Flags:

- `ok`
- `missing`
- `failed`
- `estimate`
- `suspicious`

Suspicious rule:

- `abs(delta_pct) > 0.20`
- prior base > 10,000
- not newly approved

## Model Contract

RootFetch structural model fields (`DVI_v1` and `Regime_v1`) are defined in:

- `docs/model_contract_v1.md`

Formulas and thresholds in that document are versioned and deterministic.
