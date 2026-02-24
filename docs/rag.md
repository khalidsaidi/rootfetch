# RootFetch RAG

RootFetch supports two RAG forms:

1. Local SQLite FTS index under `.ai/rag/` (developer tooling)
2. Committed static chunks under `data/rag/` (Vercel MCP runtime)

## Indexed Sources

- `README.md`
- `docs/*.md`
- `data/digests/*.md` (capped)

## Chunking

Static build defaults:

- chunk size: 1100 chars
- overlap: 160 chars
- digest cap: last 60
- hard chunk cap: 2000

If chunk cap is exceeded, oldest digest chunks are dropped first.

## Static Build Command

```bash
rootfetch rag build-static
```

Outputs:

- `data/rag/rag_chunks.json`
- `data/rag/rag_meta.json`

These files are committed and served to Vercel MCP.

## Local SQLite Build (optional)

```bash
rootfetch rag build
rootfetch rag search "count_ns_sld"
```

SQLite index path:

- `.ai/rag/rootfetch_rag.sqlite` (gitignored)

## MCP Integration

Vercel `rag_search` and `rag_get_chunk` read static `rag_chunks.json`.
Search uses lexical scoring (token overlap + phrase boost) for fast, cheap retrieval.
