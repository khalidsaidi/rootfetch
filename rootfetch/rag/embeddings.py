from __future__ import annotations

from typing import Any


def embeddings_available() -> bool:
    try:
        import sentence_transformers  # noqa: F401
        import faiss  # noqa: F401
    except Exception:
        return False
    return True


def build_embeddings_index(*args: Any, **kwargs: Any) -> dict[str, Any]:
    raise NotImplementedError(
        "Embeddings backend is optional and not enabled in this baseline. "
        "Use ROOTFETCH_RAG_BACKEND=fts (default)."
    )
