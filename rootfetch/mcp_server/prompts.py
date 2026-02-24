from __future__ import annotations

from mcp.server.fastmcp import FastMCP


def rootfetch_daily_brief_prompt(date: str = "latest") -> str:
    return f"""Prepare a RootFetch daily brief for {date}.

Workflow:
1. Read resource `rootfetch://digest/{date}`.
2. Read resource `rootfetch://signals/latest` (or date-specific signal resources if needed).
3. Summarize top movers, anomalies, and sector index changes.
4. Include concrete values and cite which resource each value came from.
"""


def rootfetch_investigate_tld_prompt(tld: str, days: int = 30) -> str:
    return f"""Investigate TLD `{tld}` over the last {days} days.

Workflow:
1. Call tool `rootfetch_get_tld_timeseries_tool` with `tld={tld}` and `days={days}`.
2. Inspect growth, volatility, and anomaly indicators.
3. If needed, call `rootfetch_anomalies_tool` for the latest date.
4. Report key inflection points and cite exact data points.
"""


def register_prompts(mcp: FastMCP) -> None:
    @mcp.prompt()
    def rootfetch_daily_brief(date: str = "latest") -> str:
        """Prompt template for creating a daily RootFetch brief."""

        return rootfetch_daily_brief_prompt(date=date)

    @mcp.prompt()
    def rootfetch_investigate_tld(tld: str, days: int = 30) -> str:
        """Prompt template for investigating one TLD."""

        return rootfetch_investigate_tld_prompt(tld=tld, days=days)
