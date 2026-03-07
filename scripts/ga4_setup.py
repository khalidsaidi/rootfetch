#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def _manual_steps() -> str:
    return (
        "Manual fallback:\n"
        "1) In Google Analytics Admin, create a GA4 property named 'RootFetch' (timezone UTC).\n"
        "2) Create a Web stream for https://rootfetch.com.\n"
        "3) Copy the Measurement ID (G-XXXXXXX).\n"
        "4) Save it to env NEXT_PUBLIC_GA_MEASUREMENT_ID and data/config/ga4.json.\n"
    )


def _load_google_clients():
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except Exception:
        print(
            "Missing dependencies. Install with:\n"
            "  pip install google-api-python-client google-auth-oauthlib google-auth-httplib2",
            file=sys.stderr,
        )
        raise
    return InstalledAppFlow, build


def _pick_account(service: Any, account_id: str | None) -> str:
    if account_id:
        return account_id
    response = service.accounts().list().execute()
    accounts = response.get("accounts", [])
    if not accounts:
        raise RuntimeError("No GA accounts visible for this user.")
    name = accounts[0].get("name", "")
    if not name:
        raise RuntimeError("Could not resolve default account.")
    return name.split("/")[-1]


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create GA4 property + web stream for RootFetch")
    parser.add_argument("--account-id", default=None, help="Numeric Analytics account id (optional).")
    parser.add_argument(
        "--client-secrets",
        default=os.getenv("GOOGLE_OAUTH_CLIENT_SECRETS", ".ai/tmp/google_oauth_client.json"),
        help="OAuth client secrets JSON path.",
    )
    parser.add_argument("--site-url", default="https://rootfetch.com")
    parser.add_argument("--property-name", default="RootFetch")
    parser.add_argument("--timezone", default="UTC")
    parser.add_argument("--currency", default="USD")
    args = parser.parse_args()

    client_path = Path(args.client_secrets)
    if not client_path.exists():
        print(f"Client secrets file missing: {client_path}", file=sys.stderr)
        print(_manual_steps(), file=sys.stderr)
        return 2

    try:
        InstalledAppFlow, build = _load_google_clients()
    except Exception:
        print(_manual_steps(), file=sys.stderr)
        return 2

    scopes = [
        "https://www.googleapis.com/auth/analytics.edit",
        "https://www.googleapis.com/auth/analytics.readonly",
    ]

    try:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_path), scopes=scopes)
        creds = flow.run_console()

        service = build("analyticsadmin", "v1beta", credentials=creds, cache_discovery=False)
        account_id = _pick_account(service, args.account_id)
        parent = f"accounts/{account_id}"

        property_body = {
            "displayName": args.property_name,
            "timeZone": args.timezone,
            "currencyCode": args.currency,
        }
        created_property = service.properties().create(parent=parent, body=property_body).execute()
        property_name = created_property.get("name", "")
        if not property_name:
            raise RuntimeError("Property creation returned empty name.")

        stream_body = {
            "displayName": "RootFetch Web",
            "defaultUri": args.site_url,
        }
        created_stream = service.properties().dataStreams().create(parent=property_name, body=stream_body).execute()

        property_id = property_name.split("/")[-1]
        measurement_id = created_stream.get("webStreamData", {}).get("measurementId")
        if not measurement_id:
            raise RuntimeError("Web stream created but measurementId missing.")

        ga4_payload = {
            "property_id": property_id,
            "measurement_id": measurement_id,
            "site_url": args.site_url,
            "stream_name": "RootFetch Web",
        }
        _save_json(Path("data/config/ga4.json"), ga4_payload)

        token_payload = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        }
        token_path = Path(".ai/tmp/ga_oauth_tokens.json")
        _save_json(token_path, token_payload)

        print(json.dumps({
            "property_id": property_id,
            "measurement_id": measurement_id,
            "ga4_config_path": "data/config/ga4.json",
            "token_cache_path": str(token_path),
        }, indent=2))
        return 0
    except Exception as exc:
        print(f"GA4 setup failed: {exc}", file=sys.stderr)
        print(_manual_steps(), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
