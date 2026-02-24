# RootFetch Metrics Spec

This document defines RootFetch metric semantics for CZDS-derived daily aggregates.

## Scope

RootFetch does not publish registration counts. It publishes zone-derived proxies
for active DNS delegations.

## Primary Metric

### `count_ns_sld` (RootFetch primary metric)

Definition:

- For TLD `tld` on date `D`, count unique second-level owner names with at least
  one `NS` record in the zone.
- Count only SLD depth (`example.tld`):
  - include owners with exactly 2 labels for single-label TLDs
  - exclude apex `tld`
  - exclude deeper labels like `a.example.tld`

Interpretation:

- Proxy for active delegated domains in the zone.

Caveat:

- Not equal to total registered domains.

## Secondary Metrics

### `count_ds_sld` (DNSSEC delegation proxy)

Definition:

- Number of unique SLD owners (`example.tld`) with at least one `DS` record.

Use:

- Track DNSSEC delegation adoption at SLD level.

### `count_glue_hosts` (in-zone glue host footprint)

Definition:

- Number of unique hostnames under the TLD that appear as owner names of `A` or
  `AAAA` records.

Use:

- Rough indicator of infrastructure footprint/self-hosted nameserver hosts.

### `count_ns_rr` (raw NS RR lines)

Definition:

- Count of `NS` RR lines in the zone (not unique owners).

Use:

- Detect delegation pattern shifts; not a domain count.

### Operational Metrics

- `bytes_downloaded`: compressed transfer bytes consumed in stream.
- `fetch_seconds`: fetch + parse runtime per TLD.
- `status`: `ok` or `failed`.
- `error`: short failure reason if `status=failed`.

## Derived Daily Metrics

Per TLD/day:

- `delta_abs = count_today - count_yesterday`
- `delta_pct = delta_abs / count_yesterday` (blank when missing or denominator 0)
- `ma7_delta_abs`, `ma7_delta_pct`
- `ma30_delta_abs`, `ma30_delta_pct`
- `accel_abs = delta_abs_today - delta_abs_yesterday`
- `accel_pct = delta_pct_today - delta_pct_yesterday`

## Data Quality Flags

- `ok`: valid daily result.
- `missing`: no usable count for day.
- `failed`: fetch/parse failure.
- `estimate`: HLL mode used.
- `suspicious`: large discontinuity rule triggered.

Suspicious discontinuity rule:

- If `abs(delta_pct) > 0.20` and `count_yesterday > 10,000` and not newly
  approved, mark as `suspicious`.
