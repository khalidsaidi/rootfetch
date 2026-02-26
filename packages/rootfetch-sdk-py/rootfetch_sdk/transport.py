from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


def _sanitize_relative_path(relative_path: str) -> str:
    value = (relative_path or "").replace("\\", "/").lstrip("/")
    parts = [part for part in value.split("/") if part]
    if not parts:
        raise ValueError("relative_path must be non-empty.")
    if any(part in {".", ".."} for part in parts):
        raise ValueError(f"unsafe relative path: {relative_path}")
    return "/".join(parts)


class Transport(Protocol):
    def get_bytes(self, relative_path: str) -> bytes:  # pragma: no cover - interface
        ...


@dataclass(frozen=True)
class HttpTransport:
    base_url: str
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if not self.base_url or not self.base_url.strip():
            raise ValueError("base_url must be non-empty.")

    def get_bytes(self, relative_path: str) -> bytes:
        safe = _sanitize_relative_path(relative_path)
        root = self.base_url.rstrip("/")
        url = f"{root}/rootfetch/artifacts/{quote(safe, safe='/')}"
        request = Request(url, method="GET")
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return response.read()
        except HTTPError as exc:  # pragma: no cover - network path
            raise RuntimeError(f"HTTP {exc.code} while fetching {safe}") from exc
        except URLError as exc:  # pragma: no cover - network path
            raise RuntimeError(f"Network error while fetching {safe}: {exc}") from exc


@dataclass(frozen=True)
class FileTransport:
    root_dir: str | Path

    def __post_init__(self) -> None:
        root = Path(self.root_dir).resolve()
        object.__setattr__(self, "root_dir", root)

    def get_bytes(self, relative_path: str) -> bytes:
        safe = _sanitize_relative_path(relative_path)
        root = Path(self.root_dir)
        target = (root / safe).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"path escapes root_dir: {relative_path}") from exc
        return target.read_bytes()

