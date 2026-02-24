from __future__ import annotations

from pathlib import Path

from rootfetch.rag.fts import FTSStore


def test_fts_search_returns_hits(tmp_path: Path) -> None:
    db_path = tmp_path / "rag.sqlite"
    store = FTSStore(db_path)
    try:
        store.replace_all_chunks(
            [
                {
                    "id": "c1",
                    "source_path": "/repo/docs/metrics_spec.md",
                    "source_type": "doc",
                    "date_utc": None,
                    "title": "Metrics",
                    "text": "count_ns_sld is the active delegated domains proxy metric.",
                },
                {
                    "id": "c2",
                    "source_path": "/repo/docs/signal_spec.md",
                    "source_type": "doc",
                    "date_utc": None,
                    "title": "Signals",
                    "text": "Top movers and anomalies are computed from delta_pct values.",
                },
            ]
        )
        hits = store.search("anomalies", k=5)
        assert hits
        assert hits[0]["id"] == "c2"
    finally:
        store.close()
