from __future__ import annotations

import json
from typing import Any

import pandas as pd
from mcp.server.fastmcp import FastMCP

from rootfetch import __version__
from rootfetch.config import Settings, get_settings
from rootfetch.mcp_server.resources import latest_data_date
from rootfetch.mcp_server.schemas import HealthResponse, TimeSeriesPoint
from rootfetch.rag.index import RAGIndex


def _read_latest_payload(settings: Settings) -> dict[str, Any]:
    if not settings.latest_signals_path.exists():
        return {}
    payload = json.loads(settings.latest_signals_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        return payload
    return {}


def _read_growth_df(settings: Settings) -> pd.DataFrame:
    if not settings.growth_trends_path.exists():
        return pd.DataFrame()
    df = pd.read_csv(settings.growth_trends_path, dtype=str)
    for col in ("count", "delta_abs", "delta_pct"):
        df[f"{col}_num"] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values(["tld", "date_utc"])


def rootfetch_health_data(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    response = HealthResponse(
        version=__version__,
        latest_data_date=latest_data_date(settings),
        has_growth_trends=settings.growth_trends_path.exists(),
        has_latest_signals=settings.latest_signals_path.exists(),
    )
    return response.to_dict()


def rootfetch_get_latest_data(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return _read_latest_payload(settings)


def rootfetch_get_tld_timeseries_data(tld: str, days: int = 30, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    tld = tld.strip().lower()
    df = _read_growth_df(settings)
    if df.empty:
        return {"tld": tld, "points": [], "summary": {}}

    rows = df[df["tld"].str.lower() == tld].tail(max(1, int(days))).copy()
    points = [
        TimeSeriesPoint(
            date=row["date_utc"],
            count=None if pd.isna(row["count_num"]) else int(row["count_num"]),
            delta_abs=None if pd.isna(row["delta_abs_num"]) else float(row["delta_abs_num"]),
            delta_pct=None if pd.isna(row["delta_pct_num"]) else float(row["delta_pct_num"]),
        ).to_dict()
        for _, row in rows.iterrows()
    ]
    last_row = rows.tail(1)
    ma7 = rows["delta_pct_num"].tail(7).mean() if not rows.empty else None
    vol30 = rows["delta_pct_num"].tail(30).std(ddof=0) if not rows.empty else None
    summary = {}
    if not last_row.empty:
        record = last_row.iloc[0]
        summary = {
            "last_count": None if pd.isna(record["count_num"]) else int(record["count_num"]),
            "last_delta_abs": None if pd.isna(record["delta_abs_num"]) else float(record["delta_abs_num"]),
            "last_delta_pct": None if pd.isna(record["delta_pct_num"]) else float(record["delta_pct_num"]),
            "ma7_delta_pct": None if pd.isna(ma7) else float(ma7),
            "vol30": None if pd.isna(vol30) else float(vol30),
        }
    return {"tld": tld, "points": points, "summary": summary}


def rootfetch_top_movers_data(date: str, by: str = "abs", limit: int = 20, settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    path = settings.signals_dir / f"{date}_top_movers.csv"
    if not path.exists():
        return []
    df = pd.read_csv(path)
    mapping = {"abs": "top_abs_growers", "pct": "top_pct_growers"}
    leaderboard = mapping.get(by, "top_abs_growers")
    subset = df[df["leaderboard"] == leaderboard].head(max(1, int(limit)))
    return subset.to_dict(orient="records")


def rootfetch_anomalies_data(date: str, limit: int = 50, settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    path = settings.signals_dir / f"{date}_anomalies.csv"
    if not path.exists():
        return []
    df = pd.read_csv(path)
    return df.head(max(1, int(limit))).to_dict(orient="records")


def rag_search_data(query: str, k: int = 8, filters: dict[str, Any] | None = None, settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    index = RAGIndex.from_settings(settings)
    return index.search(query=query, k=k, filters=filters)


def rag_get_chunk_data(id: str, settings: Settings | None = None) -> dict[str, Any] | None:
    settings = settings or get_settings()
    index = RAGIndex.from_settings(settings)
    return index.get_chunk(id)


def register_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def rootfetch_health() -> dict[str, Any]:
        """Return RootFetch server health and latest available data date."""

        return rootfetch_health_data()

    @mcp.tool()
    def rootfetch_get_latest() -> dict[str, Any]:
        """Return the parsed data/signals/latest.json payload."""

        return rootfetch_get_latest_data()

    @mcp.tool()
    def rootfetch_get_tld_timeseries(tld: str, days: int = 30) -> dict[str, Any]:
        """Return timeseries points and summary metrics for a TLD."""

        return rootfetch_get_tld_timeseries_data(tld=tld, days=days)

    @mcp.tool()
    def rootfetch_top_movers(date: str, by: str = "abs", limit: int = 20) -> list[dict[str, Any]]:
        """Return top movers for a specific date (abs or pct leaderboard)."""

        return rootfetch_top_movers_data(date=date, by=by, limit=limit)

    @mcp.tool()
    def rootfetch_anomalies(date: str, limit: int = 50) -> list[dict[str, Any]]:
        """Return anomalies for a specific date."""

        return rootfetch_anomalies_data(date=date, limit=limit)

    @mcp.tool()
    def rag_search(query: str, k: int = 8, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Search docs and digests via RootFetch RAG index."""

        return rag_search_data(query=query, k=k, filters=filters)

    @mcp.tool()
    def rag_get_chunk(id: str) -> dict[str, Any] | None:
        """Return full chunk text and metadata by chunk id."""

        return rag_get_chunk_data(id=id)
