#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 examples/verify_run.py <run_id>", file=sys.stderr)
        return 2

    run_id = sys.argv[1]
    repo_root = Path(__file__).resolve().parents[1]
    sdk_root = repo_root / "packages" / "rootfetch-sdk-py"
    artifacts_root = repo_root / "data" / "artifacts"

    sys.path.insert(0, str(sdk_root))
    from rootfetch_sdk import FileTransport, RootFetch  # noqa: WPS433

    rf = RootFetch(transport=FileTransport(root_dir=artifacts_root))
    result = rf.verify_manifest(run_id)
    print(json.dumps(result, indent=2))
    return 0 if result.get("valid") else 1


if __name__ == "__main__":
    raise SystemExit(main())

