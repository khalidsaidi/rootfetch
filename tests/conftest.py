from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from rootfetch.config import get_settings


@pytest.fixture()
def temp_settings(tmp_path: Path):
    settings = get_settings()
    base = tmp_path
    ai = base / ".ai"
    data = base / "data"
    docs = base / "docs"
    sector_map_path = base / "rootfetch" / "resources" / "tld_sectors.yml"
    sector_map_path.parent.mkdir(parents=True, exist_ok=True)
    sector_map_path.write_text("sectors:\n  other:\n    - \"*\"\n", encoding="utf-8")

    updated = replace(
        settings,
        repo_root=base,
        ai_dir=ai,
        data_dir=data,
        docs_dir=docs,
        approved_dir=data / "approved_tlds",
        daily_counts_dir=data / "daily_counts",
        signals_dir=data / "signals",
        digests_dir=data / "digests",
        token_cache_path=ai / "token.json",
        approved_snapshot_path=ai / "approved_snapshot.json",
        logs_dir=ai / "logs",
        snapshots_dir=ai / "snapshots",
        rag_dir=ai / "rag",
        rag_db_path=ai / "rag" / "rootfetch_rag.sqlite",
        growth_trends_path=data / "growth_trends.csv",
        latest_signals_path=data / "signals" / "latest.json",
        sector_map_path=sector_map_path,
        execution_plan_path=ai / "execution_plan.md",
        hybrid_plan_path=base / "rootfetch" / "resources" / "hybrid_plan.yml",
        static_rag_dir=data / "rag",
        static_rag_chunks_path=data / "rag" / "rag_chunks.json",
        static_rag_meta_path=data / "rag" / "rag_meta.json",
    )

    for path in [
        updated.ai_dir,
        updated.data_dir,
        updated.docs_dir,
        updated.approved_dir,
        updated.daily_counts_dir,
        updated.signals_dir,
        updated.digests_dir,
        updated.logs_dir,
        updated.snapshots_dir,
        updated.rag_dir,
        updated.static_rag_dir,
    ]:
        path.mkdir(parents=True, exist_ok=True)

    return updated
