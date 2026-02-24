from __future__ import annotations

import logging
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from rootfetch.config import get_settings
from rootfetch.mcp_server.prompts import register_prompts
from rootfetch.mcp_server.resources import register_resources
from rootfetch.mcp_server.tools import register_tools
from rootfetch.rag.index import RAGIndex


def _configure_logging() -> None:
    logger = logging.getLogger("rootfetch.mcp")
    if logger.handlers:
        return
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False


def build_server() -> FastMCP:
    _configure_logging()
    mcp = FastMCP("rootfetch")
    register_resources(mcp)
    register_tools(mcp)
    register_prompts(mcp)
    return mcp


def _prepare_rag_index() -> None:
    settings = get_settings()
    index = RAGIndex.from_settings(settings)
    if settings.rag_autobuild and not settings.rag_db_path.exists():
        logging.getLogger("rootfetch.mcp").info("building missing RAG index at startup")
        index.build()


def run_server(transport: str = "stdio", port: int = 8000) -> None:
    _prepare_rag_index()
    mcp = build_server()
    if transport == "streamable-http":
        mcp.run(transport="streamable-http", port=port)
    else:
        mcp.run(transport="stdio")


def main() -> int:
    run_server(transport="stdio", port=8000)
    return 0
