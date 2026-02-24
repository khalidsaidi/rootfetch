from __future__ import annotations

from rootfetch.rag.static_build import build_static_rag


def test_build_static_rag_outputs_files(temp_settings, monkeypatch) -> None:
    temp_settings.docs_dir.mkdir(parents=True, exist_ok=True)
    temp_settings.digests_dir.mkdir(parents=True, exist_ok=True)
    (temp_settings.repo_root / "README.md").write_text("# RootFetch\nHybrid cadence and movers.\n", encoding="utf-8")
    (temp_settings.docs_dir / "metrics_spec.md").write_text("# Metrics\ncount_ns_sld definition.\n", encoding="utf-8")
    (temp_settings.docs_dir / "signal_spec.md").write_text("# Signals\ncore movers and rolling updates.\n", encoding="utf-8")
    (temp_settings.digests_dir / "2026-02-20.md").write_text("# Digest\nTop movers.\n", encoding="utf-8")
    (temp_settings.digests_dir / "2026-02-21.md").write_text("# Digest\nAnomalies.\n", encoding="utf-8")

    monkeypatch.setenv("ROOTFETCH_RAG_MAX_DIGESTS", "10")
    monkeypatch.setenv("ROOTFETCH_RAG_MAX_CHUNKS", "200")

    meta = build_static_rag(settings=temp_settings)
    assert meta["sources_indexed"] >= 3
    assert meta["chunks_indexed"] > 0
    assert temp_settings.static_rag_chunks_path.exists()
    assert temp_settings.static_rag_meta_path.exists()
