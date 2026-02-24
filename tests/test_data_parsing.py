from __future__ import annotations

from pathlib import Path

from rootfetch.mcp_server.resources import latest_data_date
from rootfetch.mcp_server.tools import rootfetch_get_tld_timeseries_data


def test_timeseries_parsing_from_growth_csv(temp_settings) -> None:
    fixtures = Path(__file__).resolve().parent / "fixtures"
    temp_settings.growth_trends_path.write_text((fixtures / "growth_sample.csv").read_text(encoding="utf-8"), encoding="utf-8")
    temp_settings.latest_signals_path.parent.mkdir(parents=True, exist_ok=True)
    temp_settings.latest_signals_path.write_text((fixtures / "latest_sample.json").read_text(encoding="utf-8"), encoding="utf-8")

    series = rootfetch_get_tld_timeseries_data("app", days=30, settings=temp_settings)
    assert len(series["points"]) == 2
    assert series["summary"]["last_count"] == 100
    assert latest_data_date(temp_settings) == "2026-02-24"
