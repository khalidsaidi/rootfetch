#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from rootfetch.config import get_settings
from rootfetch.core.auth import get_access_token
from rootfetch.core.io_utils import utc_now_iso, utc_today_str


def main() -> int:
    settings = get_settings()
    token = get_access_token(settings=settings)
    if not token:
        raise RuntimeError("Authentication did not return an access token.")

    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    date_utc = utc_today_str()
    log_path = settings.logs_dir / f"auth_ok_{date_utc}.log"
    log_path.write_text(f"{utc_now_iso()} auth_check=ok\n", encoding="utf-8")
    print(f"auth_check=ok log={log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
