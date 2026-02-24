from __future__ import annotations

from rootfetch.rag.chunking import chunk_text


def test_chunk_ids_are_stable() -> None:
    text = "# Title\n\nThis is a rootfetch chunking test document.\n" * 80
    first = chunk_text(
        text,
        source_path="/tmp/doc.md",
        source_type="doc",
        date_utc=None,
        default_title="doc",
        chunk_size=900,
        overlap=120,
    )
    second = chunk_text(
        text,
        source_path="/tmp/doc.md",
        source_type="doc",
        date_utc=None,
        default_title="doc",
        chunk_size=900,
        overlap=120,
    )
    assert [chunk.id for chunk in first] == [chunk.id for chunk in second]
    assert len(first) >= 2
