from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


class FTSStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def close(self) -> None:
        self.conn.close()

    def _init_schema(self) -> None:
        cur = self.conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                source_path TEXT NOT NULL,
                source_type TEXT NOT NULL,
                date_utc TEXT,
                title TEXT,
                text TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(id UNINDEXED, text)
            """
        )
        self.conn.commit()

    def replace_all_chunks(self, chunks: list[dict[str, Any]]) -> None:
        cur = self.conn.cursor()
        cur.execute("DELETE FROM chunks")
        cur.execute("DELETE FROM chunks_fts")
        cur.executemany(
            "INSERT INTO chunks(id, source_path, source_type, date_utc, title, text) VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    item["id"],
                    item["source_path"],
                    item["source_type"],
                    item.get("date_utc"),
                    item.get("title"),
                    item["text"],
                )
                for item in chunks
            ],
        )
        cur.executemany(
            "INSERT INTO chunks_fts(id, text) VALUES (?, ?)",
            [(item["id"], item["text"]) for item in chunks],
        )
        self.conn.commit()

    def get_chunk(self, chunk_id: str) -> dict[str, Any] | None:
        cur = self.conn.cursor()
        row = cur.execute(
            "SELECT id, source_path, source_type, date_utc, title, text FROM chunks WHERE id = ?",
            (chunk_id,),
        ).fetchone()
        if not row:
            return None
        return dict(row)

    def search(self, query: str, k: int = 8) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        cur = self.conn.cursor()
        try:
            rows = cur.execute(
                """
                SELECT
                    c.id,
                    c.source_path,
                    c.source_type,
                    c.date_utc,
                    c.title,
                    snippet(chunks_fts, 1, '[', ']', '...', 20) AS excerpt,
                    bm25(chunks_fts) AS score
                FROM chunks_fts
                JOIN chunks c ON c.id = chunks_fts.id
                WHERE chunks_fts MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (query, int(k)),
            ).fetchall()
        except sqlite3.OperationalError:
            like_query = f"%{query}%"
            rows = cur.execute(
                """
                SELECT
                    id,
                    source_path,
                    source_type,
                    date_utc,
                    title,
                    substr(text, 1, 280) AS excerpt,
                    9999.0 AS score
                FROM chunks
                WHERE text LIKE ?
                LIMIT ?
                """,
                (like_query, int(k)),
            ).fetchall()
        return [dict(row) for row in rows]
