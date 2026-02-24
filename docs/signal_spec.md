# RootFetch Signal Spec

RootFetch signal outputs are derived from daily `count_ns_sld` trend data unless
stated otherwise.

## Daily Top Movers

Output: `data/signals/<YYYY-MM-DD>_top_movers.csv`

Leaderboards (top 20 each):

1. Absolute growers: `delta_abs` descending
2. Percentage growers: `delta_pct` descending with `count_yesterday >= ROOTFETCH_MIN_BASE_FOR_PCT`
3. Absolute decliners: `delta_abs` ascending

Columns:

- `date_utc`, `tld`, `count`, `delta_abs`, `delta_pct`, `accel_abs`,
  `is_estimate`, `data_quality`, `leaderboard`

## Volatility

Output: `data/signals/<YYYY-MM-DD>_volatility.csv`

Definitions:

- `vol7 = stddev(delta_pct over trailing 7 valid days)`
- `vol30 = stddev(delta_pct over trailing 30 valid days)`
- `valid_days_30 = number of valid days in trailing window`

Columns:

- `date_utc`, `tld`, `vol7`, `vol30`, `valid_days_30`, `is_estimate`,
  `data_quality`

## Sector Indices

Map file: `rootfetch/resources/tld_sectors.yml`

Rules:

- TLD can belong to multiple sectors.
- Unmapped TLDs fall back to `other` (wildcard sector if present).

Daily calculations:

- `sector_count = sum(count_ns_sld where status=ok for sector members)`
- `sector_delta_abs = sector_count_today - sector_count_yesterday`
- `sector_delta_pct = sector_delta_abs / sector_count_yesterday` (blank when unavailable)

Outputs:

- Append-only: `data/signals/sector_indices.csv`
- Daily snapshot: `data/signals/<YYYY-MM-DD>_sector_snapshot.csv`

## Anomaly Scoring

Output: `data/signals/<YYYY-MM-DD>_anomalies.csv`

Baseline window:

- trailing 30 days (min 14 valid days)

Scores:

- `z = (delta_pct_today - mean(delta_pct_baseline)) / std(delta_pct_baseline)`
- `robust_z = 0.6745 * (delta_pct_today - median) / MAD`

Flag conditions:

- `abs(z) >= 3.0` with baseline >= 14 days
- or `abs(robust_z) >= 3.5` with baseline >= 14 days
- or `data_quality == suspicious`
- optional recovery flag when prior status was missing/failed and current is ok

Reason codes:

- `zscore`, `robust_z`, `suspicious_jump`, `missing_data_recovery`

Columns:

- `date_utc`, `tld`, `count`, `delta_pct`, `z`, `robust_z`, `baseline_days`,
  `reason`, `is_estimate`, `data_quality`

## Latest Product Snapshot

Output: `data/signals/latest.json` (overwritten daily)

Contains:

- run metadata (`date_utc`, `run_id`, `approved_tlds_count`)
- top movers (`top_movers_abs`, `top_movers_pct`, `top_decliners_abs`)
- anomalies
- sector snapshot
