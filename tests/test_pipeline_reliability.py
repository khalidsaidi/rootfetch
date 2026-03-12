from __future__ import annotations

from dataclasses import replace

import requests

from rootfetch.core.pipeline import _download_and_count, _prepare_baseline_rows


class _DummyLogger:
    def info(self, *_args, **_kwargs) -> None:
        return None

    def warning(self, *_args, **_kwargs) -> None:
        return None


def test_download_and_count_stops_when_fetch_budget_expires(temp_settings, monkeypatch) -> None:
    settings = replace(temp_settings, http_timeout=120, retry_max=8, fetch_max_seconds=5)
    attempts: list[object] = []

    def _fake_get(*_args, **kwargs):
        attempts.append(kwargs.get("timeout"))
        raise requests.Timeout("forced-timeout")

    monotonic_tick = {"value": 0}

    def _fake_monotonic() -> int:
        monotonic_tick["value"] += 1
        return monotonic_tick["value"]

    monkeypatch.setattr("rootfetch.core.pipeline.requests.get", _fake_get)
    monkeypatch.setattr("rootfetch.core.pipeline._sleep_backoff", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("rootfetch.core.pipeline.time.monotonic", _fake_monotonic)

    metric = _download_and_count(
        "https://example.test/slow.zone.gz",
        "slow",
        "token",
        settings,
        retry_max=8,
        fetch_max_seconds=5,
    )

    assert metric["status"] == "failed"
    assert metric["error"] == "fetch_time_budget_exceeded"
    assert attempts
    assert len(attempts) <= 3


def test_prepare_baseline_rows_uses_tail_policy_for_small_pending(temp_settings, monkeypatch) -> None:
    seen_retry_values: list[int | None] = []
    seen_fetch_budget_values: list[int | None] = []

    def _fake_download(_url, tld, _token, settings, **kwargs):
        seen_retry_values.append(kwargs.get("retry_max"))
        seen_fetch_budget_values.append(kwargs.get("fetch_max_seconds"))
        return {
            "tld": tld,
            "count_ns_sld": 100,
            "count_ds_sld": 0,
            "count_glue_hosts": 0,
            "count_ns_rr": 0,
            "is_estimate": False,
            "count_mode": settings.count_mode,
            "bytes_downloaded": 10,
            "fetch_seconds": 0.1,
            "fetched_at_utc": "2026-03-10T00:00:00+00:00",
            "status": "ok",
            "error": "",
        }

    monkeypatch.setattr("rootfetch.core.pipeline._download_and_count", _fake_download)

    _prepare_baseline_rows(
        date_utc="2026-03-10",
        approved_tlds=["app", "dev"],
        target_links=[
            {"tld": "app", "url": "https://example.test/app.zone.gz"},
            {"tld": "dev", "url": "https://example.test/dev.zone.gz"},
        ],
        progress_tlds=["app", "dev"],
        token="token",
        settings=temp_settings,
        logger=_DummyLogger(),
    )

    assert seen_retry_values
    assert seen_fetch_budget_values
    assert all(value == temp_settings.baseline_tail_retry_max for value in seen_retry_values)
    assert all(value == temp_settings.baseline_tail_fetch_max_seconds for value in seen_fetch_budget_values)


def test_download_and_count_enforces_budget_during_stream_parse(temp_settings, monkeypatch) -> None:
    settings = replace(temp_settings, http_timeout=120, retry_max=0, fetch_max_seconds=5)

    class _SlowRaw:
        def __init__(self) -> None:
            self.decode_content = False
            self.closed = False

        def read(self, _size: int = -1) -> bytes:
            return b"example.\t60\tIN\tNS\tns1.example.\n"

        def readable(self) -> bool:
            return True

        def writable(self) -> bool:
            return False

        def seekable(self) -> bool:
            return False

        def close(self) -> None:
            self.closed = True

    class _SlowResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.headers = {"Content-Type": "text/plain"}
            self.raw = _SlowRaw()

        def close(self) -> None:
            return None

    monotonic_tick = {"value": 0}

    def _fake_monotonic() -> int:
        monotonic_tick["value"] += 1
        return monotonic_tick["value"]

    monkeypatch.setattr("rootfetch.core.pipeline.requests.get", lambda *_args, **_kwargs: _SlowResponse())
    monkeypatch.setattr("rootfetch.core.pipeline._sleep_backoff", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("rootfetch.core.pipeline.time.monotonic", _fake_monotonic)

    metric = _download_and_count(
        "https://example.test/slow.zone",
        "slow",
        "token",
        settings,
        retry_max=0,
        fetch_max_seconds=5,
    )

    assert metric["status"] == "failed"
    assert metric["error"] == "fetch_time_budget_exceeded"
