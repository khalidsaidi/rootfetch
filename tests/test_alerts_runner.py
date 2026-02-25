from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from rootfetch.alerts.runner import run_alerts


def _write_approvals_diff(temp_settings, *, date_utc: str, added: list[str]) -> None:
    temp_settings.signals_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "date_utc": date_utc,
        "prev_date_utc": "2026-02-24",
        "added": added,
        "removed": [],
        "added_count": len(added),
        "removed_count": 0,
    }
    (temp_settings.signals_dir / f"{date_utc}_approvals_diff.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )


def _state_path(temp_settings):
    return temp_settings.ai_dir / "alerts" / "state.json"


def test_alerts_dry_run_does_not_persist_state(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")

    result = run_alerts(date_utc=date_utc, dry_run=True, settings=temp_settings)
    assert result["alerts_count"] == 1
    assert result["queue"]["enqueued"] == 1
    assert not _state_path(temp_settings).exists()


def test_alerts_retry_persistence_and_recovery(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")

    calls = {"count": 0}

    def _flaky_send(channel: str, webhook_url: str, text: str) -> None:
        calls["count"] += 1
        assert channel == "slack"
        assert webhook_url
        assert text
        if calls["count"] == 1:
            raise RuntimeError("transient")

    monkeypatch.setattr("rootfetch.alerts.runner._send_channel", _flaky_send)

    first = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert first["delivery"]["failed_attempts"] == 1
    assert first["queue"]["active_count"] == 1

    state_path = _state_path(temp_settings)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["active"][0]["next_attempt_at_utc"] = (
        datetime.now(tz=timezone.utc) - timedelta(seconds=1)
    ).isoformat()
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    second = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert second["delivery"]["sent_attempts"] == 1
    assert second["queue"]["active_count"] == 0

    final_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert final_state["active"] == []
    assert final_state["delivered_index"]


def test_alerts_deduplicate_recent_delivery(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")

    sent = {"count": 0}

    def _ok_send(channel: str, webhook_url: str, text: str) -> None:
        sent["count"] += 1
        assert channel == "slack"
        assert webhook_url
        assert text

    monkeypatch.setattr("rootfetch.alerts.runner._send_channel", _ok_send)

    first = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert first["delivery"]["sent_attempts"] == 1
    assert sent["count"] == 1

    second = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert second["queue"]["skipped_duplicate"] >= 1
    assert second["delivery"]["sent_attempts"] == 0
    assert sent["count"] == 1
