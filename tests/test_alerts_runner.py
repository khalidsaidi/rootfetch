from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from rootfetch.alerts.runner import AlertItem, _dedup_key, _snapshot_date_bucket, run_alerts


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
        json.dumps(payload),
        encoding="utf-8",
    )


def _state_path(temp_settings) -> Path:
    return temp_settings.ai_dir / "alerts" / "state.json"


def _delivery_log_path(temp_settings) -> Path:
    return temp_settings.ai_dir / "alerts" / "delivery_log.jsonl"


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
    monkeypatch.setenv("ROOTFETCH_ALERT_RETRY_JITTER_PCT", "0")

    calls = {"count": 0}

    def _flaky_send(
        channel: str,
        webhook_url: str,
        text: str,
        *,
        dedup_key: str,
        payload_hash: str,
    ) -> None:
        calls["count"] += 1
        assert channel == "slack"
        assert webhook_url
        assert text
        assert dedup_key
        assert payload_hash
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

    delivery_rows = [
        json.loads(line)
        for line in _delivery_log_path(temp_settings).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert delivery_rows
    assert {"retry", "success"} <= {row["result"] for row in delivery_rows}
    assert all(row.get("dedup_key") for row in delivery_rows)
    assert all(row.get("payload_hash") for row in delivery_rows)


def test_alerts_deduplicate_recent_delivery(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")

    sent = {"count": 0}

    def _ok_send(
        channel: str,
        webhook_url: str,
        text: str,
        *,
        dedup_key: str,
        payload_hash: str,
    ) -> None:
        sent["count"] += 1
        assert channel == "slack"
        assert webhook_url
        assert text
        assert dedup_key
        assert payload_hash

    monkeypatch.setattr("rootfetch.alerts.runner._send_channel", _ok_send)

    first = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert first["delivery"]["sent_attempts"] == 1
    assert sent["count"] == 1

    second = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert second["queue"]["skipped_duplicate"] >= 1
    assert second["delivery"]["sent_attempts"] == 0
    assert sent["count"] == 1


def test_dead_letter_contains_payload_and_error_context(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")
    monkeypatch.setenv("ROOTFETCH_ALERT_RETRY_MAX", "1")

    def _fail_send(
        channel: str,
        webhook_url: str,
        text: str,
        *,
        dedup_key: str,
        payload_hash: str,
    ) -> None:
        raise RuntimeError("delivery failed")

    monkeypatch.setattr("rootfetch.alerts.runner._send_channel", _fail_send)

    result = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert result["delivery"]["dead_letter_items"] == 1
    assert result["queue"]["active_count"] == 0

    state = json.loads(_state_path(temp_settings).read_text(encoding="utf-8"))
    assert state["dead_letters"]
    dead = state["dead_letters"][-1]
    assert dead["payload"]["code"] == "new_approvals"
    assert dead["last_error"] == "delivery failed"
    assert dead["attempts_total"] == 1
    assert dead["dedup_key"]
    assert "requeue_hint" in dead

    rows = [
        json.loads(line)
        for line in _delivery_log_path(temp_settings).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows[-1]["result"] == "dead_letter"
    assert rows[-1]["error_class"] == "RuntimeError"


def test_corrupt_state_requires_explicit_recover(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_SLACK_WEBHOOK_URL", "https://example.test/slack")

    state_path = _state_path(temp_settings)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text("{not-json", encoding="utf-8")

    def _ok_send(
        channel: str,
        webhook_url: str,
        text: str,
        *,
        dedup_key: str,
        payload_hash: str,
    ) -> None:
        assert channel == "slack"

    monkeypatch.setattr("rootfetch.alerts.runner._send_channel", _ok_send)
    result = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert result["skipped_due_to_corrupt_state"] is True
    assert "requires explicit recovery" in result["error"]
    assert not state_path.exists()

    quarantined = list(state_path.parent.glob("state.corrupt.*.json"))
    assert quarantined, "expected invalid state snapshot to be quarantined"

    state_path.write_text("{still-bad", encoding="utf-8")
    recovered = run_alerts(
        date_utc=date_utc,
        dry_run=False,
        recover_corrupt_state=True,
        settings=temp_settings,
    )
    assert recovered["delivery"]["sent_attempts"] == 1
    assert recovered["recovered_from_corrupt_state"]
    assert state_path.exists()
    loaded = json.loads(state_path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)


def test_lock_timeout_returns_skip_payload(temp_settings, monkeypatch) -> None:
    date_utc = "2026-02-25"
    _write_approvals_diff(temp_settings, date_utc=date_utc, added=["foo"])
    monkeypatch.setenv("ROOTFETCH_ALERT_LOCK_TIMEOUT_SECONDS", "0")

    class _FakeFcntl:
        LOCK_EX = 1
        LOCK_NB = 2
        LOCK_UN = 8

        @staticmethod
        def flock(*args, **kwargs):
            raise BlockingIOError("busy")

    monkeypatch.setattr("rootfetch.alerts.runner.fcntl", _FakeFcntl)
    result = run_alerts(date_utc=date_utc, dry_run=False, settings=temp_settings)
    assert result["skipped_due_to_lock"] is True
    assert "lock unavailable" in result["error"]


def test_dedup_key_is_stable_for_identical_alert_inputs() -> None:
    item = AlertItem(
        code="anomaly",
        severity="warning",
        message="Anomaly .xyz: reason=zscore",
        rule_id="anomaly_zscore_threshold",
        entity_id="tld:xyz",
        trigger_signature="z=3.2000;threshold=3.0",
    )
    assert _dedup_key("2026-02-25", item) == _dedup_key("2026-02-25", item)

    changed = AlertItem(
        code="anomaly",
        severity="warning",
        message="Anomaly .xyz: reason=zscore",
        rule_id="anomaly_zscore_threshold",
        entity_id="tld:xyz",
        trigger_signature="z=3.5000;threshold=3.0",
    )
    assert _dedup_key("2026-02-25", item) != _dedup_key("2026-02-25", changed)


def test_snapshot_bucket_uses_utc_date_component() -> None:
    assert _snapshot_date_bucket("2026-02-25") == "2026-02-25"
    assert _snapshot_date_bucket("2026-02-25T23:59:59+00:00") == "2026-02-25"
    with pytest.raises(ValueError):
        _snapshot_date_bucket("not-a-date")
