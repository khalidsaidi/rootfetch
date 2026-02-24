from __future__ import annotations

import json

from rootfetch.core.hybrid_select import load_hybrid_plan, select_hybrid_tlds
from rootfetch.core.pipeline import run_hybrid


def test_hybrid_selection_is_deterministic(temp_settings) -> None:
    temp_settings.hybrid_plan_path.parent.mkdir(parents=True, exist_ok=True)
    temp_settings.hybrid_plan_path.write_text(
        "hybrid:\n"
        "  rolling_period_days: 7\n"
        "  rolling_min_per_day: 2\n"
        "  rolling_max_per_day: 4\n"
        "  core_daily_tlds:\n"
        "    - app\n"
        "    - dev\n",
        encoding="utf-8",
    )

    approved = ["app", "dev", "xyz", "shop", "news", "cloud", "finance", "ai", "blog"]
    plan = load_hybrid_plan(settings=temp_settings)
    first = select_hybrid_tlds(approved_tlds=approved, date_utc="2026-02-24", plan=plan, settings=temp_settings)
    second = select_hybrid_tlds(approved_tlds=approved, date_utc="2026-02-24", plan=plan, settings=temp_settings)

    assert first["core_today"] == ["app", "dev"]
    assert first["rolling_today"] == second["rolling_today"]
    assert len(first["rolling_today"]) >= 2
    assert len(first["rolling_today"]) <= 4
    assert set(first["core_today"]).issubset(set(first["target_today"]))


def test_run_hybrid_dry_run_summary(temp_settings) -> None:
    temp_settings.hybrid_plan_path.parent.mkdir(parents=True, exist_ok=True)
    temp_settings.hybrid_plan_path.write_text(
        "hybrid:\n"
        "  rolling_period_days: 14\n"
        "  rolling_min_per_day: 1\n"
        "  rolling_max_per_day: 10\n"
        "  core_daily_tlds:\n"
        "    - app\n"
        "    - dev\n"
        "    - xyz\n",
        encoding="utf-8",
    )
    temp_settings.approved_dir.mkdir(parents=True, exist_ok=True)
    (temp_settings.approved_dir / "latest.json").write_text(
        json.dumps(
            {
                "date_utc": "2026-02-24",
                "fetched_at_utc": "2026-02-24T00:00:00+00:00",
                "count": 6,
                "tlds": ["app", "dev", "xyz", "shop", "blog", "news"],
            }
        ),
        encoding="utf-8",
    )

    result = run_hybrid(date_utc="2026-02-24", dry_run=True, settings=temp_settings)
    summary = result.summary
    assert summary["approved_count"] == 6
    assert summary["core_today_count"] == 3
    assert summary["total_target_count"] >= 3
