# RootFetch Signal Spec

RootFetch signals are hybrid-aware.

## Hybrid Inputs

- Core cadence rows: `cadence=core`, expected `days_since_prev=1`
- Rolling cadence rows: `cadence=rolling`, `days_since_prev` may be >1

All signal computations use `count_ns_sld` as the primary count.

## Core Daily Movers

Output: `data/signals/<YYYY-MM-DD>_core_top_movers.csv`

Leaderboards (top 20 each):

1. `top_abs_growers`
2. `top_pct_growers` (requires previous base >= `ROOTFETCH_MIN_BASE_FOR_PCT`)
3. `top_abs_decliners`

Filters:

- `status=ok`
- `cadence=core`
- `days_since_prev=1`

Columns:

- `date_utc, tld, count, delta_abs, delta_pct, accel_abs, is_estimate, data_quality, leaderboard`

Compatibility file:

- `data/signals/<YYYY-MM-DD>_top_movers.csv` mirrors core movers.

## Rolling Updates

Output: `data/signals/<YYYY-MM-DD>_rolling_updates.csv`

Shows rolling TLD updates compared to the last observed date.

Columns:

- `date_utc, tld, count, prev_date_utc, days_since_prev, delta_abs, delta_pct, is_estimate, data_quality`

## Volatility

Output: `data/signals/<YYYY-MM-DD>_volatility.csv`

- `vol7 = stddev(delta_pct over trailing 7 valid points)`
- `vol30 = stddev(delta_pct over trailing 30 valid points)`

Columns:

- `date_utc, tld, vol7, vol30, valid_days_30, is_estimate, data_quality`

## Anomalies

Output: `data/signals/<YYYY-MM-DD>_anomalies.csv`

Flags by any condition:

- `abs(z) >= 3.0` with baseline >= 14
- `abs(robust_z) >= 3.5` with baseline >= 14
- `data_quality == suspicious`
- prior recovery after missing/failed

Columns:

- `date_utc, tld, count, delta_pct, z, robust_z, baseline_days, reason, is_estimate, data_quality`

## Sector Indices

Outputs:

- `data/signals/sector_indices.csv` (append-only)
- `data/signals/<YYYY-MM-DD>_sector_snapshot.csv`

## Latest Snapshot

Output: `data/signals/latest.json`

Includes:

- coverage fields (`approved_tlds_count`, `counted_today_count`, `counted_today_core_count`, `counted_today_rolling_count`, `coverage_pct_today`)
- core mover arrays (`core_movers_abs`, `core_movers_pct`)
- rolling updates (`rolling_updates`)
- compatibility mover arrays (`top_movers_abs`, `top_movers_pct`, `top_decliners_abs`)
- anomalies and sector snapshot
- model contract fields:
  - `model_version`
  - `methodology_version`
  - `dvi_components`
  - `dvi_band`
  - `regime`
  - `regime_confidence`
  - `regime_inputs`
  - `regime_base`
  - `regime_candidate`
  - `regime_duration_snapshots`
  - `model_calibration`

See `docs/model_contract_v1.md` for the exact formulas, thresholds, and versioning policy.
