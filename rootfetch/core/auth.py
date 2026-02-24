from __future__ import annotations

import json
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
import requests

from rootfetch.config import Settings, get_settings
from rootfetch.core.io_utils import read_json, write_json

AUTH_URL = "https://account-api.icann.org/api/authenticate"


def _parse_iso_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _decode_expiry(token: str) -> datetime | None:
    try:
        payload = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
    except Exception:
        return None
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    return datetime.fromtimestamp(exp, tz=timezone.utc)


def _cache_valid(cache: dict[str, Any], now_utc: datetime) -> bool:
    token = cache.get("token")
    expires_at = _parse_iso_utc(cache.get("expires_at_utc"))
    if not token or not expires_at:
        return False
    return expires_at - now_utc > timedelta(minutes=10)


def _load_cached_token(settings: Settings) -> str | None:
    if not settings.token_cache_path.exists():
        return None
    cache = read_json(settings.token_cache_path)
    if not isinstance(cache, dict):
        return None
    now_utc = datetime.now(tz=timezone.utc)
    if _cache_valid(cache, now_utc):
        return str(cache["token"])
    return None


def _save_cached_token(settings: Settings, token: str) -> None:
    now_utc = datetime.now(tz=timezone.utc)
    expires_at = _decode_expiry(token)
    payload = {
        "token": token,
        "fetched_at_utc": now_utc.isoformat(),
        "expires_at_utc": expires_at.isoformat() if expires_at else None,
    }
    write_json(settings.token_cache_path, payload)


def _auth_request(settings: Settings, payload: dict[str, Any]) -> tuple[int, dict[str, Any], str | None]:
    max_retries = min(max(settings.retry_max, 0), 3)
    last_status = 0
    last_body: dict[str, Any] = {}
    for attempt in range(max_retries + 1):
        response = requests.post(
            AUTH_URL,
            json=payload,
            timeout=settings.http_timeout,
            headers={"Accept": "application/json"},
        )
        last_status = response.status_code
        try:
            last_body = response.json()
        except ValueError:
            text = response.text.strip()
            if text:
                last_body = {"detail": text[:300]}
            else:
                last_body = {}
        token = last_body.get("accessToken")
        if isinstance(token, str) and token:
            return response.status_code, last_body, token
        if response.status_code == 429 or 500 <= response.status_code <= 599:
            if attempt < max_retries:
                delay = min(2**attempt, 8) + random.uniform(0.0, 0.5)
                time.sleep(delay)
                continue
        return response.status_code, last_body, None
    return last_status, last_body, None


def _looks_like_mfa_required(status_code: int, body: dict[str, Any]) -> bool:
    if status_code in {401, 403, 422}:
        text = json.dumps(body).lower()
        keywords = ("mfa", "otp", "totp", "verification code", "two-factor")
        if any(keyword in text for keyword in keywords):
            return True
    return False


def _record_auth_note(settings: Settings, note: str) -> None:
    note_path = settings.ai_dir / "notes_auth.md"
    note_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(tz=timezone.utc).isoformat()
    with note_path.open("a", encoding="utf-8") as fh:
        fh.write(f"- {timestamp} {note}\n")


def get_access_token(*, settings: Settings | None = None, dry_run: bool = False) -> str:
    settings = settings or get_settings()
    if dry_run:
        return "dry-run-token"

    cached = _load_cached_token(settings)
    if cached:
        return cached

    if not settings.username or not settings.password:
        raise RuntimeError("Missing CZDS credentials: CZDS_USERNAME/CZDS_PASSWORD must be set.")

    base_payload = {"username": settings.username, "password": settings.password}
    status_code, body, token = _auth_request(settings, base_payload)
    if token:
        _save_cached_token(settings, token)
        return token

    if settings.totp_secret and _looks_like_mfa_required(status_code, body):
        totp_code = pyotp.TOTP(settings.totp_secret).now()
        for field_name in ("otp", "totp", "mfaCode", "code"):
            payload = dict(base_payload)
            payload[field_name] = totp_code
            status_code, body, token = _auth_request(settings, payload)
            if token:
                _record_auth_note(settings, f"authentication succeeded with MFA field '{field_name}'")
                _save_cached_token(settings, token)
                return token

    message = ""
    if isinstance(body, dict):
        for key in ("message", "error", "detail", "title"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                message = value.strip()
                break
    raise RuntimeError(f"CZDS auth failed (status={status_code}). {message}".strip())
