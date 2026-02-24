from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class HealthResponse:
    version: str
    latest_data_date: str | None
    has_growth_trends: bool
    has_latest_signals: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TimeSeriesPoint:
    date: str
    count: int | None
    delta_abs: float | None
    delta_pct: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
