#!/usr/bin/env python3
"""Refresh data/tld_wiki.json: what each TLD's name means, from Wikipedia's list of TLDs.

Only fields Wikipedia states are kept (brand owner, translation, target area, intended use);
nothing is inferred. Keeps the previous file when Wikipedia can't be reached.
"""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

API = ("https://en.wikipedia.org/w/api.php?action=parse&page=List_of_internet_top-level_domains"
       "&redirects=1&prop=text&format=json&formatversion=2")
SOURCE = "https://en.wikipedia.org/wiki/List_of_Internet_top-level_domains"
OUT = Path(__file__).resolve().parents[1] / "data" / "tld_wiki.json"
COLUMNS = [("intended use", "use"), ("translation", "translation"), ("english translation", "translation"),
           ("target geographic area", "geo"), ("entity", "entity")]


def _cells(row: str) -> list[str]:
    raw = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
    clean = (re.sub(r"<[^>]+>", "", re.sub(r"<sup.*?</sup>", "", c, flags=re.S)) for c in raw)
    return [re.sub(r"\s+", " ", html.unescape(c)).strip() for c in clean]


def main() -> None:
    req = urllib.request.Request(API, headers={"User-Agent": "rootfetch.com (+https://github.com/khalidsaidi/rootfetch)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            page = json.load(resp)["parse"]["text"]
    except Exception as exc:
        print(f"tld wiki: Wikipedia unreachable ({exc}); keeping {OUT.name}", file=sys.stderr)
        return
    out: dict[str, dict[str, str]] = {}
    for table in re.findall(r'<table class="[^"]*wikitable.*?</table>', page, re.S):
        rows = re.findall(r"<tr.*?</tr>", table, re.S)
        if not rows:
            continue
        header = [h.lower() for h in _cells(rows[0])]
        for row in rows[1:]:
            cells = _cells(row)
            if len(cells) < 2:
                continue
            name = cells[0].lstrip(".").lower()
            if not re.fullmatch(r"(xn--)?[a-z0-9-]+", name):
                continue
            fields = dict(zip(header, cells))
            for column, key in COLUMNS:
                value = fields.get(column, "").strip().strip('"')
                if value and value not in ("—", "-"):
                    out.setdefault(name, {})[key] = value[:200]
    if len(out) < 300:
        print(f"tld wiki: only {len(out)} rows parsed, refusing to overwrite", file=sys.stderr)
        return
    OUT.write_text(json.dumps({"source": SOURCE, "tlds": dict(sorted(out.items()))}, indent=0, ensure_ascii=False) + "\n")
    print(f"tld wiki: {len(out)} TLDs written to {OUT.relative_to(OUT.parents[1])}")


if __name__ == "__main__":
    main()
