from __future__ import annotations

import os
from collections import Counter
from pathlib import Path
from typing import Any

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import utc_now_iso, write_json
from rootfetch.rag.chunking import chunk_text, infer_date_utc, infer_source_type


def _parse_positive_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value.strip())
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _resource_uri(source_path: str, date_utc: str | None) -> str:
    norm = source_path.replace("\\", "/")
    if norm.startswith("data/digests/"):
        if date_utc:
            return f"rootfetch://digest/{date_utc}"
        return "rootfetch://digest/latest"
    if norm == "README.md":
        return "rootfetch://docs/readme"
    if norm.startswith("docs/") and norm.endswith(".md"):
        stem = Path(norm).stem.lower()
        return f"rootfetch://docs/{stem}"
    return "rootfetch://growth_trends"


def _collect_sources(settings: Settings, max_digests: int) -> list[Path]:
    sources: list[Path] = []
    readme = settings.repo_root / "README.md"
    if readme.exists():
        sources.append(readme)

    docs = sorted(settings.docs_dir.glob("*.md"))
    sources.extend(docs)

    dated_digests = sorted(
        path
        for path in settings.digests_dir.glob("*.md")
        if path.name != "latest.md"
    )
    if max_digests > 0:
        dated_digests = dated_digests[-max_digests:]
    sources.extend(dated_digests)
    return sources


def _to_rel(path: Path, repo_root: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path).replace("\\", "/")


def build_static_rag(*, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    max_digests = _parse_positive_int(os.getenv("ROOTFETCH_RAG_MAX_DIGESTS"), 60)
    max_chunks = _parse_positive_int(os.getenv("ROOTFETCH_RAG_MAX_CHUNKS"), 2000)
    chunk_size = _parse_positive_int(os.getenv("ROOTFETCH_RAG_CHUNK_SIZE"), 1100)
    overlap = _parse_positive_int(os.getenv("ROOTFETCH_RAG_CHUNK_OVERLAP"), 160)
    if overlap >= chunk_size:
        overlap = max(100, chunk_size // 6)

    sources = _collect_sources(settings, max_digests=max_digests)
    base_chunks: list[dict[str, Any]] = []
    digest_chunks: list[dict[str, Any]] = []
    source_counts = Counter()

    for source in sources:
        if not source.exists():
            continue
        rel_source = _to_rel(source, settings.repo_root)
        text = source.read_text(encoding="utf-8")
        source_type = infer_source_type(source)
        source_counts[source_type] += 1
        date_utc = infer_date_utc(source) if source_type == "digest" else None
        chunks = chunk_text(
            text,
            source_path=rel_source,
            source_type=source_type,
            date_utc=date_utc,
            default_title=source.stem,
            chunk_size=chunk_size,
            overlap=overlap,
        )
        target = digest_chunks if source_type == "digest" else base_chunks
        for chunk in chunks:
            target.append(
                {
                    "id": chunk.id,
                    "source_path": chunk.source_path,
                    "source_type": chunk.source_type,
                    "date_utc": chunk.date_utc,
                    "title": chunk.title,
                    "text": chunk.text,
                    "resource_uri": _resource_uri(chunk.source_path, chunk.date_utc),
                }
            )

    all_chunks = base_chunks + digest_chunks
    if len(all_chunks) > max_chunks:
        # Keep docs/readme first; drop oldest digest chunks deterministically.
        digest_chunks.sort(key=lambda row: (row.get("date_utc") or "", row["source_path"], row["id"]))
        keep_digest_count = max(0, max_chunks - len(base_chunks))
        digest_chunks = digest_chunks[-keep_digest_count:] if keep_digest_count > 0 else []
        all_chunks = (base_chunks + digest_chunks)[:max_chunks]

    settings.static_rag_dir.mkdir(parents=True, exist_ok=True)
    write_json(settings.static_rag_chunks_path, {"chunks": all_chunks})
    meta = {
        "built_at_utc": utc_now_iso(),
        "sources_indexed": len(sources),
        "source_type_counts": dict(source_counts),
        "chunks_indexed": len(all_chunks),
        "max_digests": max_digests,
        "max_chunks": max_chunks,
        "chunk_size": chunk_size,
        "chunk_overlap": overlap,
        "chunks_path": str(settings.static_rag_chunks_path),
    }
    write_json(settings.static_rag_meta_path, meta)
    return meta
