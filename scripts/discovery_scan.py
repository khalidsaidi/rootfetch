#!/usr/bin/env python3
from __future__ import annotations

from rootfetch.core.pipeline import run_discovery_only
from rootfetch.core.io_utils import utc_today_str


def main() -> int:
    date_utc = utc_today_str()
    meta = run_discovery_only(date_utc=date_utc)
    print(f"internal_snapshot={meta['internal_snapshot_path']}")
    print(f"sanitized_snapshot={meta['sanitized_path']}")
    print(f"approved_count={len(meta['tlds'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
