from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Chunk:
    id: str
    source_path: str
    source_type: str
    date_utc: str | None
    title: str | None
    text: str


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
DATE_FROM_DIGEST_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def infer_source_type(path: Path) -> str:
    path_str = str(path).lower()
    if "data/digests/" in path_str:
        return "digest"
    if path.name.lower() == "readme.md":
        return "readme"
    return "doc"


def infer_date_utc(path: Path) -> str | None:
    match = DATE_FROM_DIGEST_RE.search(path.stem)
    if match:
        return match.group(1)
    return None


def _build_heading_index(text: str) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []
    offset = 0
    for line in text.splitlines(keepends=True):
        match = HEADING_RE.match(line.strip())
        if match:
            headings.append((offset, match.group(2).strip()))
        offset += len(line)
    return headings


def _heading_for_offset(headings: list[tuple[int, str]], offset: int) -> str | None:
    selected: str | None = None
    for heading_offset, heading in headings:
        if heading_offset > offset:
            break
        selected = heading
    return selected


def chunk_text(
    text: str,
    *,
    source_path: str,
    source_type: str,
    date_utc: str | None = None,
    default_title: str | None = None,
    chunk_size: int = 1000,
    overlap: int = 150,
) -> list[Chunk]:
    text = text.strip()
    if not text:
        return []
    if overlap >= chunk_size:
        overlap = max(0, chunk_size // 5)

    headings = _build_heading_index(text)
    chunks: list[Chunk] = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(text_len, start + chunk_size)
        segment = text[start:end].strip()
        if segment:
            heading = _heading_for_offset(headings, start) or default_title
            stable = f"{source_path}|{start}|{segment}"
            chunk_id = hashlib.sha1(stable.encode("utf-8")).hexdigest()
            chunks.append(
                Chunk(
                    id=chunk_id,
                    source_path=source_path,
                    source_type=source_type,
                    date_utc=date_utc,
                    title=heading,
                    text=segment,
                )
            )
        if end >= text_len:
            break
        start = max(0, end - overlap)
    return chunks
