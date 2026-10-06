#!/usr/bin/env python3
"""Refresh data/tld_meta.json from ICANN's public gTLD registry list.

Keeps the previous file when ICANN can't be reached, so a network blip never
breaks the site build.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://www.icann.org/resources/registries/gtlds/v2/gtlds.json"
OUT = Path(__file__).resolve().parents[1] / "data" / "tld_meta.json"


def main() -> None:
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "rootfetch.com (+https://rootfetch.com/about.html)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = json.load(resp)
    except Exception as exc:  # keep the last good copy
        print(f"tld meta: ICANN unreachable ({exc}); keeping {OUT.name}", file=sys.stderr)
        return
    meta = {}
    for row in raw.get("gTLDs", []):
        tld = (row.get("gTLD") or "").lower()
        if not tld:
            continue
        meta[tld] = {
            "operator": (row.get("registryOperator") or "").strip(),
            "signed": row.get("dateOfContractSignature"),
            "delegated": row.get("delegationDate"),
            "brand": bool(row.get("specification13")),
            "terminated": bool(row.get("contractTerminated")),
            "removed": row.get("removalDate"),
            "u_label": row.get("uLabel"),
        }
    if len(meta) < 1000:
        print(f"tld meta: only {len(meta)} rows from ICANN, refusing to overwrite", file=sys.stderr)
        return
    payload = {"source": SOURCE, "updated_on": raw.get("updatedOn"), "tlds": dict(sorted(meta.items()))}
    OUT.write_text(json.dumps(payload, indent=0, ensure_ascii=False, sort_keys=False) + "\n")
    print(f"tld meta: {len(meta)} gTLDs written to {OUT.relative_to(OUT.parents[1])}")


if __name__ == "__main__":
    main()
