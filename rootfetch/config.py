from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _parse_csv_set(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip().lower() for part in value.split(",") if part.strip()}


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    stripped = value.strip()
    if not stripped:
        return default
    try:
        return int(stripped)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    ai_dir: Path
    data_dir: Path
    docs_dir: Path
    approved_dir: Path
    daily_counts_dir: Path
    signals_dir: Path
    digests_dir: Path
    token_cache_path: Path
    approved_snapshot_path: Path
    logs_dir: Path
    snapshots_dir: Path
    rag_dir: Path
    rag_db_path: Path
    growth_trends_path: Path
    latest_signals_path: Path
    sector_map_path: Path
    execution_plan_path: Path
    hybrid_plan_path: Path
    static_rag_dir: Path
    static_rag_chunks_path: Path
    static_rag_meta_path: Path

    username: str | None
    password: str | None
    totp_secret: str | None
    allowlist: set[str]
    blocklist: set[str]
    max_workers: int
    http_timeout: int
    retry_max: int
    count_mode: str
    min_base_for_pct: int
    rag_backend: str
    rag_autobuild: bool


def get_settings() -> Settings:
    load_dotenv()
    repo_root = Path(__file__).resolve().parents[1]
    ai_dir = repo_root / ".ai"
    data_dir = repo_root / "data"
    docs_dir = repo_root / "docs"
    approved_dir = data_dir / "approved_tlds"
    daily_counts_dir = data_dir / "daily_counts"
    signals_dir = data_dir / "signals"
    digests_dir = data_dir / "digests"
    static_rag_dir = data_dir / "rag"
    rag_dir = ai_dir / "rag"
    allowlist = _parse_csv_set(os.getenv("ROOTFETCH_TLD_ALLOWLIST"))
    env_blocklist = _parse_csv_set(os.getenv("ROOTFETCH_TLD_BLOCKLIST"))
    if not allowlist and not env_blocklist:
        # Safe default for first runs when no explicit allowlist is provided.
        env_blocklist = {"com", "net", "org"}

    count_mode = os.getenv("ROOTFETCH_COUNT_MODE", "ns_sld_exact").strip().lower()
    if count_mode not in {"ns_sld_exact", "ns_sld_hll"}:
        count_mode = "ns_sld_exact"

    sector_map_env = os.getenv("ROOTFETCH_SECTOR_MAP_PATH")
    sector_map_path = Path(sector_map_env) if sector_map_env else (repo_root / "rootfetch" / "resources" / "tld_sectors.yml")

    return Settings(
        repo_root=repo_root,
        ai_dir=ai_dir,
        data_dir=data_dir,
        docs_dir=docs_dir,
        approved_dir=approved_dir,
        daily_counts_dir=daily_counts_dir,
        signals_dir=signals_dir,
        digests_dir=digests_dir,
        token_cache_path=ai_dir / "token.json",
        approved_snapshot_path=ai_dir / "approved_snapshot.json",
        logs_dir=ai_dir / "logs",
        snapshots_dir=ai_dir / "snapshots",
        rag_dir=rag_dir,
        rag_db_path=rag_dir / "rootfetch_rag.sqlite",
        growth_trends_path=data_dir / "growth_trends.csv",
        latest_signals_path=signals_dir / "latest.json",
        sector_map_path=sector_map_path,
        execution_plan_path=ai_dir / "execution_plan.md",
        hybrid_plan_path=repo_root / "rootfetch" / "resources" / "hybrid_plan.yml",
        static_rag_dir=static_rag_dir,
        static_rag_chunks_path=static_rag_dir / "rag_chunks.json",
        static_rag_meta_path=static_rag_dir / "rag_meta.json",
        username=os.getenv("CZDS_USERNAME"),
        password=os.getenv("CZDS_PASSWORD"),
        totp_secret=os.getenv("CZDS_TOTP_SECRET"),
        allowlist=allowlist,
        blocklist=env_blocklist,
        max_workers=_parse_int(os.getenv("ROOTFETCH_MAX_WORKERS"), 4),
        http_timeout=_parse_int(os.getenv("ROOTFETCH_HTTP_TIMEOUT"), 60),
        retry_max=_parse_int(os.getenv("ROOTFETCH_RETRY_MAX"), 5),
        count_mode=count_mode,
        min_base_for_pct=_parse_int(os.getenv("ROOTFETCH_MIN_BASE_FOR_PCT"), 1000),
        rag_backend=os.getenv("ROOTFETCH_RAG_BACKEND", "fts").strip().lower(),
        rag_autobuild=_parse_bool(os.getenv("ROOTFETCH_RAG_AUTOBUILD"), True),
    )
