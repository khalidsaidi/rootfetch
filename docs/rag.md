# RootFetch RAG

RootFetch includes a local RAG subsystem for searching docs and daily digests.

## Indexed Sources

- `README.md`
- `docs/*.md`
- `data/digests/*.md`

## Chunking

- Target size: 1000 chars
- Overlap: 150 chars
- Stable chunk id based on source path + offset + text hash input

Chunk metadata:

- `id`, `source_path`, `source_type` (`doc|digest|readme`)
- `date_utc` (when inferred from digest filename)
- `title` (heading-derived best effort)
- `text`

## Backend

Default backend: SQLite FTS5 (`.ai/rag/rootfetch_rag.sqlite`, gitignored)

Tables:

- `chunks`
- `chunks_fts`

Optional embeddings backend is reserved behind `ROOTFETCH_RAG_BACKEND=embeddings`
but not required for baseline operation.

## CLI

Build index:

```bash
rootfetch rag build
```

Search:

```bash
rootfetch rag search "top movers anomalies"
```

## MCP integration

MCP tool `rag_search` returns:

- `id`, `score`, `source_path`, `source_type`, `date_utc`, `title`, `excerpt`,
  `resource_uri`

`resource_uri` maps directly to MCP resources:

- docs/readme -> `rootfetch://docs/{doc_name}`
- digests -> `rootfetch://digest/{date}`

MCP tool `rag_get_chunk` returns full chunk text and metadata.
