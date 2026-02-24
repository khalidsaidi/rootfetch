from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from rootfetch.config import Settings, get_settings


@dataclass(frozen=True)
class HybridPlan:
    rolling_period_days: int
    rolling_min_per_day: int
    rolling_max_per_day: int
    core_daily_tlds: list[str]


def _normalize_tlds(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out = {str(value).strip().lower() for value in values if str(value).strip()}
    return sorted(out)


def _as_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(str(value).strip())
    except Exception:
        return default
    return parsed if parsed > 0 else default


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if isinstance(payload, dict):
        return payload
    return {}


def load_hybrid_plan(*, settings: Settings | None = None) -> HybridPlan:
    settings = settings or get_settings()
    payload = _load_yaml(settings.hybrid_plan_path)
    hybrid = payload.get("hybrid", {}) if isinstance(payload, dict) else {}
    if not isinstance(hybrid, dict):
        hybrid = {}

    period = _as_positive_int(hybrid.get("rolling_period_days"), 14)
    min_per_day = _as_positive_int(hybrid.get("rolling_min_per_day"), 40)
    max_per_day = _as_positive_int(hybrid.get("rolling_max_per_day"), 120)
    if min_per_day > max_per_day:
        min_per_day = max_per_day
    core_tlds = _normalize_tlds(hybrid.get("core_daily_tlds"))

    env_period = os.getenv("ROOTFETCH_ROLLING_PERIOD_DAYS")
    env_min = os.getenv("ROOTFETCH_ROLLING_MIN_PER_DAY")
    env_max = os.getenv("ROOTFETCH_ROLLING_MAX_PER_DAY")
    if env_period:
        period = _as_positive_int(env_period, period)
    if env_min:
        min_per_day = _as_positive_int(env_min, min_per_day)
    if env_max:
        max_per_day = _as_positive_int(env_max, max_per_day)
    if min_per_day > max_per_day:
        min_per_day = max_per_day

    return HybridPlan(
        rolling_period_days=period,
        rolling_min_per_day=min_per_day,
        rolling_max_per_day=max_per_day,
        core_daily_tlds=core_tlds,
    )


def _stable_shard(tld: str, period: int) -> int:
    digest = hashlib.sha1(tld.encode("utf-8")).hexdigest()
    return int(digest, 16) % period


def _date_to_index(date_utc: str, period: int) -> int:
    parsed = date.fromisoformat(date_utc)
    return parsed.toordinal() % period


def _expand_with_neighbor_buckets(
    *,
    selected: list[str],
    buckets: dict[int, list[str]],
    day_index: int,
    period: int,
    min_count: int,
    max_count: int,
) -> list[str]:
    out = list(selected)
    seen = set(out)
    if len(out) >= min_count:
        return out[:max_count]

    for offset in range(1, period):
        bucket = (day_index + offset) % period
        for tld in buckets.get(bucket, []):
            if tld in seen:
                continue
            out.append(tld)
            seen.add(tld)
            if len(out) >= min_count or len(out) >= max_count:
                return out[:max_count]
    return out[:max_count]


def select_hybrid_tlds(
    *,
    approved_tlds: list[str],
    date_utc: str,
    plan: HybridPlan | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    plan = plan or load_hybrid_plan(settings=settings)

    approved = sorted({tld.strip().lower() for tld in approved_tlds if tld and tld.strip()})
    approved_set = set(approved)

    core_today = sorted({tld for tld in plan.core_daily_tlds if tld in approved_set})
    long_tail = sorted(approved_set - set(core_today))

    period = max(1, plan.rolling_period_days)
    day_index = _date_to_index(date_utc, period)

    buckets: dict[int, list[str]] = {idx: [] for idx in range(period)}
    for tld in long_tail:
        buckets[_stable_shard(tld, period)].append(tld)
    for idx in range(period):
        buckets[idx].sort()

    rolling_today = list(buckets.get(day_index, []))
    if len(rolling_today) > plan.rolling_max_per_day:
        rolling_today = rolling_today[: plan.rolling_max_per_day]

    rolling_today = _expand_with_neighbor_buckets(
        selected=rolling_today,
        buckets=buckets,
        day_index=day_index,
        period=period,
        min_count=plan.rolling_min_per_day,
        max_count=plan.rolling_max_per_day,
    )

    target_today = sorted(set(core_today) | set(rolling_today))
    cadence_map: dict[str, str] = {}
    for tld in core_today:
        cadence_map[tld] = "core"
    for tld in rolling_today:
        cadence_map[tld] = cadence_map.get(tld) or "rolling"

    return {
        "date_utc": date_utc,
        "approved_count": len(approved),
        "rolling_period_days": period,
        "day_index": day_index,
        "core_today": core_today,
        "rolling_today": rolling_today,
        "target_today": target_today,
        "cadence_map": cadence_map,
        "long_tail_count": len(long_tail),
        "rolling_first_10": rolling_today[:10],
    }
