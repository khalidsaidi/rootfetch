#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from dataclasses import replace
from pathlib import Path

from rootfetch.config import get_settings
from rootfetch.mcp_server.resources import (
    get_approved_tlds_text,
    get_daily_counts_text,
    get_digest_text,
    get_growth_trends_text,
    get_latest_signals_text,
)
from rootfetch.mcp_server.tools import (
    rag_get_chunk_data,
    rag_search_data,
    rootfetch_anomalies_data,
    rootfetch_get_latest_data,
    rootfetch_get_tld_timeseries_data,
    rootfetch_health_data,
    rootfetch_top_movers_data,
)
from rootfetch.rag.index import RAGIndex


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _build_temp_settings(base: Path):
    settings = get_settings()
    ai = base / ".ai"
    data = base / "data"
    docs = base / "docs"
    return replace(
        settings,
        repo_root=base,
        ai_dir=ai,
        data_dir=data,
        docs_dir=docs,
        approved_dir=data / "approved_tlds",
        daily_counts_dir=data / "daily_counts",
        signals_dir=data / "signals",
        digests_dir=data / "digests",
        token_cache_path=ai / "token.json",
        approved_snapshot_path=ai / "approved_snapshot.json",
        logs_dir=ai / "logs",
        snapshots_dir=ai / "snapshots",
        rag_dir=ai / "rag",
        rag_db_path=ai / "rag" / "rootfetch_rag.sqlite",
        growth_trends_path=data / "growth_trends.csv",
        latest_signals_path=data / "signals" / "latest.json",
        sector_map_path=base / "rootfetch" / "resources" / "tld_sectors.yml",
        execution_plan_path=ai / "execution_plan.md",
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="rootfetch_smoke_") as tmp:
        base = Path(tmp)
        settings = _build_temp_settings(base)

        date = "2026-02-24"
        _write(settings.docs_dir / "metrics_spec.md", "# Metrics\ncount_ns_sld definition\n")
        _write(settings.docs_dir / "signal_spec.md", "# Signals\nanomaly definition\n")
        _write(base / "README.md", "# RootFetch\nTop movers and anomalies digest\n")
        _write(
            settings.daily_counts_dir / f"{date}.csv",
            "date_utc,tld,count,is_estimate,source,fetched_at_utc,notes,count_mode,count_ds_sld,count_glue_hosts,count_ns_rr,bytes_downloaded,fetch_seconds,status,error\n"
            f"{date},app,100,false,czds_zone,2026-02-24T00:00:00+00:00,,ns_sld_exact,10,5,200,1000,1.2,ok,\n",
        )
        _write(
            settings.growth_trends_path,
            "date_utc,tld,count,delta_abs,delta_pct,is_estimate,approved_today,run_id,fetched_at_utc,count_mode,status\n"
            f"{date},app,100,5,0.05,false,false,run1,2026-02-24T00:00:00+00:00,ns_sld_exact,ok\n",
        )
        _write(
            settings.approved_dir / f"{date}.json",
            json.dumps({"date_utc": date, "count": 1, "tlds": ["app"]}, indent=2),
        )
        _write(settings.digests_dir / f"{date}.md", f"# Digest {date}\nTop movers app\n")
        _write(settings.digests_dir / "latest.md", f"# Digest {date}\nTop movers app\n")
        _write(
            settings.signals_dir / f"{date}_top_movers.csv",
            "date_utc,tld,count,delta_abs,delta_pct,accel_abs,is_estimate,data_quality,leaderboard\n"
            f"{date},app,100,5,0.05,1,false,ok,top_abs_growers\n",
        )
        _write(
            settings.signals_dir / f"{date}_anomalies.csv",
            "date_utc,tld,count,delta_pct,z,robust_z,baseline_days,reason,is_estimate,data_quality\n"
            f"{date},app,100,0.05,1.0,0.8,20,zscore,false,ok\n",
        )
        _write(
            settings.signals_dir / f"{date}_sector_snapshot.csv",
            "date_utc,sector,sector_count,sector_delta_abs,sector_delta_pct,member_tlds_count,notes\n"
            f"{date},ai_tech,100,5,0.05,1,\n",
        )
        _write(
            settings.latest_signals_path,
            json.dumps(
                {
                    "date_utc": date,
                    "run_id": "run1",
                    "approved_tlds_count": 1,
                    "top_movers_abs": [{"tld": "app", "delta_abs": 5, "count": 100}],
                    "top_movers_pct": [],
                    "top_decliners_abs": [],
                    "anomalies": [],
                    "sector_snapshot": [],
                },
                indent=2,
            ),
        )

        assert "approved_tlds_count" in get_latest_signals_text(settings)
        assert "date_utc,tld,count" in get_growth_trends_text(settings)
        assert "app" in get_daily_counts_text(date, settings)
        assert "app" in get_approved_tlds_text(date, settings)
        assert "Digest" in get_digest_text("latest", settings)

        health = rootfetch_health_data(settings)
        assert health["has_latest_signals"] is True
        latest = rootfetch_get_latest_data(settings)
        assert latest["date_utc"] == date
        ts = rootfetch_get_tld_timeseries_data("app", 30, settings)
        assert len(ts["points"]) == 1
        movers = rootfetch_top_movers_data(date, "abs", 5, settings)
        assert movers and movers[0]["tld"] == "app"
        anomalies = rootfetch_anomalies_data(date, 5, settings)
        assert anomalies and anomalies[0]["reason"] == "zscore"

        rag = RAGIndex.from_settings(settings)
        stats = rag.build()
        assert stats["chunks_indexed"] > 0
        hits = rag_search_data("anomaly", 5, None, settings)
        assert hits
        chunk = rag_get_chunk_data(hits[0]["id"], settings)
        assert chunk is not None and "text" in chunk

    print("smoke_mcp=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
