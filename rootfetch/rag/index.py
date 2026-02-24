from __future__ import annotations

from pathlib import Path
from typing import Any

from rootfetch.config import Settings, get_settings
from rootfetch.rag.chunking import chunk_text, infer_date_utc, infer_source_type
from rootfetch.rag.fts import FTSStore


def _resource_uri_for_chunk(chunk: dict[str, Any]) -> str:
    source_path = str(chunk.get("source_path", "")).replace("\\", "/")
    date_utc = chunk.get("date_utc")
    if "/data/digests/" in source_path:
        if date_utc:
            return f"rootfetch://digest/{date_utc}"
        return "rootfetch://digest/latest"
    if source_path.endswith("/README.md"):
        return "rootfetch://docs/readme"
    if "/docs/" in source_path and source_path.endswith(".md"):
        stem = Path(source_path).stem.lower()
        return f"rootfetch://docs/{stem}"
    return "rootfetch://growth_trends"


class RAGIndex:
    def __init__(self, settings: Settings, db_path: Path | None = None):
        self.settings = settings
        self.db_path = db_path or settings.rag_db_path

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "RAGIndex":
        return cls(settings or get_settings())

    def _sources(self) -> list[Path]:
        sources: list[Path] = []
        readme_path = self.settings.repo_root / "README.md"
        if readme_path.exists():
            sources.append(readme_path)
        docs = sorted((self.settings.docs_dir).glob("*.md"))
        sources.extend(docs)
        digests = sorted((self.settings.digests_dir).glob("*.md"))
        sources.extend(digests)
        return sources

    def build(self) -> dict[str, Any]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        chunks: list[dict[str, Any]] = []
        source_count = 0
        for source in self._sources():
            source_count += 1
            text = source.read_text(encoding="utf-8")
            source_type = infer_source_type(source)
            date_utc = infer_date_utc(source) if source_type == "digest" else None
            for chunk in chunk_text(
                text,
                source_path=str(source),
                source_type=source_type,
                date_utc=date_utc,
                default_title=source.stem,
                chunk_size=1000,
                overlap=150,
            ):
                chunks.append(
                    {
                        "id": chunk.id,
                        "source_path": chunk.source_path,
                        "source_type": chunk.source_type,
                        "date_utc": chunk.date_utc,
                        "title": chunk.title,
                        "text": chunk.text,
                    }
                )
        store = FTSStore(self.db_path)
        try:
            store.replace_all_chunks(chunks)
        finally:
            store.close()
        return {"db_path": str(self.db_path), "sources_indexed": source_count, "chunks_indexed": len(chunks)}

    def _ensure_built(self) -> None:
        if self.db_path.exists():
            return
        if self.settings.rag_autobuild:
            self.build()
            return
        raise RuntimeError("RAG index is missing and ROOTFETCH_RAG_AUTOBUILD=false")

    def search(self, query: str, k: int = 8, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self._ensure_built()
        store = FTSStore(self.db_path)
        try:
            rows = store.search(query, k=max(1, int(k)))
        finally:
            store.close()
        filtered_rows = rows
        if filters:
            if "source_type" in filters:
                source_type = str(filters["source_type"]).lower()
                filtered_rows = [row for row in filtered_rows if str(row.get("source_type", "")).lower() == source_type]
            if "date_utc" in filters:
                date_utc = str(filters["date_utc"])
                filtered_rows = [row for row in filtered_rows if str(row.get("date_utc", "")) == date_utc]

        out: list[dict[str, Any]] = []
        for row in filtered_rows[:k]:
            resource_uri = _resource_uri_for_chunk(row)
            out.append(
                {
                    "id": row["id"],
                    "score": float(row["score"]) if row.get("score") is not None else None,
                    "source_path": row["source_path"],
                    "source_type": row["source_type"],
                    "date_utc": row.get("date_utc"),
                    "title": row.get("title"),
                    "excerpt": row.get("excerpt", ""),
                    "resource_uri": resource_uri,
                }
            )
        return out

    def get_chunk(self, chunk_id: str) -> dict[str, Any] | None:
        self._ensure_built()
        store = FTSStore(self.db_path)
        try:
            row = store.get_chunk(chunk_id)
        finally:
            store.close()
        if not row:
            return None
        row["resource_uri"] = _resource_uri_for_chunk(row)
        return row
