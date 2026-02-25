from __future__ import annotations

import argparse
import json
from pathlib import Path

from rootfetch.config import get_settings
from rootfetch.core.auth import get_access_token
from rootfetch.core.io_utils import utc_now_iso, utc_today_str
from rootfetch.core.pipeline import (
    baseline_completion_status,
    run_baseline,
    run_daily,
    run_discovery_only,
    run_hybrid,
)
from rootfetch.alerts import run_alerts
from rootfetch.signals.compute import compute_signals_for_date
from rootfetch.signals.digest import write_daily_digest
from rootfetch.rag.static_build import build_static_rag


def _add_common_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--dry-run", action="store_true")


def _cmd_auth_check(args: argparse.Namespace) -> int:
    settings = get_settings()
    token = get_access_token(settings=settings, dry_run=args.dry_run)
    if not token:
        raise RuntimeError("No access token returned.")
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = settings.logs_dir / f"auth_ok_{utc_today_str()}.log"
    log_path.write_text(f"{utc_now_iso()} auth_check=ok\n", encoding="utf-8")
    print(f"auth_check=ok log={log_path}")
    return 0


def _cmd_discover(args: argparse.Namespace) -> int:
    meta = run_discovery_only(date_utc=utc_today_str(), dry_run=args.dry_run)
    print(json.dumps(
        {
            "internal_snapshot": str(meta["internal_snapshot_path"]),
            "sanitized_snapshot": str(meta["sanitized_path"]),
            "approved_count": len(meta["tlds"]),
        },
        indent=2,
    ))
    return 0


def _cmd_run_daily(args: argparse.Namespace) -> int:
    result = run_daily(date_utc=args.date, dry_run=args.dry_run, verbose=args.verbose)
    print(
        json.dumps(
            {
                "date_utc": result.date_utc,
                "run_id": result.run_id,
                "selected_tlds": len(result.selected_tlds),
                "processed_tlds": len(result.processed_tlds),
                "failed_tlds": result.failed_tlds,
                "outputs": result.outputs,
                "summary": result.summary,
            },
            indent=2,
        )
    )
    return 0


def _cmd_run_hybrid(args: argparse.Namespace) -> int:
    result = run_hybrid(
        date_utc=args.date,
        dry_run=args.dry_run,
        verbose=args.verbose,
        skip_discovery=args.skip_discovery,
    )
    print(
        json.dumps(
            {
                "date_utc": result.date_utc,
                "run_id": result.run_id,
                "selected_tlds": len(result.selected_tlds),
                "processed_tlds": len(result.processed_tlds),
                "failed_tlds": result.failed_tlds,
                "outputs": result.outputs,
                "summary": result.summary,
            },
            indent=2,
        )
    )
    return 0


def _cmd_run_baseline(args: argparse.Namespace) -> int:
    result = run_baseline(
        date_utc=args.date,
        dry_run=args.dry_run,
        verbose=args.verbose,
        resume=args.resume,
        skip_discovery=args.skip_discovery,
    )
    print(
        json.dumps(
            {
                "date_utc": result.date_utc,
                "run_id": result.run_id,
                "selected_tlds": len(result.selected_tlds),
                "processed_tlds": len(result.processed_tlds),
                "failed_tlds": result.failed_tlds,
                "outputs": result.outputs,
                "summary": result.summary,
            },
            indent=2,
        )
    )
    return 0


def _cmd_baseline_status(args: argparse.Namespace) -> int:
    status = baseline_completion_status(date_utc=args.date)
    print(json.dumps(status, indent=2))
    return 0


def _cmd_compute_signals(args: argparse.Namespace) -> int:
    if not args.date:
        raise RuntimeError("--date is required for compute-signals")
    settings = get_settings()
    signal_meta = compute_signals_for_date(args.date, settings=settings)
    digest_meta = write_daily_digest(args.date, settings=settings)
    print(
        json.dumps(
            {
                "date_utc": args.date,
                "top_movers": str(signal_meta["top_movers_path"]),
                "core_top_movers": str(signal_meta["core_top_movers_path"]),
                "rolling_updates": str(signal_meta["rolling_updates_path"]),
                "volatility": str(signal_meta["volatility_path"]),
                "anomalies": str(signal_meta["anomalies_path"]),
                "sector_snapshot": str(signal_meta["sector_snapshot_path"]),
                "top_tlds": str(signal_meta["top_tlds_path"]),
                "distribution": str(signal_meta["distribution_path"]),
                "concentration": str(signal_meta["concentration_path"]),
                "approvals_diff": str(signal_meta["approvals_diff_path"]),
                "security_status": str(signal_meta["security_status_path"]),
                "latest": str(signal_meta["latest_path"]),
                "coverage": str(signal_meta["coverage_path"]),
                "digest": str(digest_meta["dated_digest_path"]),
            },
            indent=2,
        )
    )
    return 0


def _cmd_rag_build(args: argparse.Namespace) -> int:
    from rootfetch.rag.index import RAGIndex

    index = RAGIndex.from_settings()
    stats = index.build()
    print(json.dumps(stats, indent=2))
    return 0


def _cmd_rag_build_static(args: argparse.Namespace) -> int:
    stats = build_static_rag()
    print(json.dumps(stats, indent=2))
    return 0


def _cmd_rag_search(args: argparse.Namespace) -> int:
    from rootfetch.rag.index import RAGIndex

    index = RAGIndex.from_settings()
    hits = index.search(args.query, k=args.k)
    print(json.dumps(hits, indent=2))
    return 0


def _cmd_mcp_serve(args: argparse.Namespace) -> int:
    from rootfetch.mcp_server.server import run_server

    run_server(transport=args.transport, port=args.port)
    return 0


def _cmd_alerts_run(args: argparse.Namespace) -> int:
    date_utc = args.date or utc_today_str()
    payload = run_alerts(date_utc=date_utc, dry_run=args.dry_run)
    print(json.dumps(payload, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rootfetch")
    subparsers = parser.add_subparsers(dest="command", required=True)

    auth_check = subparsers.add_parser("auth-check", help="Verify CZDS authentication")
    _add_common_flags(auth_check)
    auth_check.set_defaults(func=_cmd_auth_check)

    discover = subparsers.add_parser("discover", help="Fetch and write approved TLD snapshots")
    _add_common_flags(discover)
    discover.set_defaults(func=_cmd_discover)

    run_daily_cmd = subparsers.add_parser("run-daily", help="Run the full daily pipeline")
    _add_common_flags(run_daily_cmd)
    run_daily_cmd.add_argument("--date", default=None, help="UTC date YYYY-MM-DD (default: today)")
    run_daily_cmd.set_defaults(func=_cmd_run_daily)

    run_hybrid_cmd = subparsers.add_parser("run-hybrid", help="Run deterministic hybrid ingestion (core + rolling)")
    _add_common_flags(run_hybrid_cmd)
    run_hybrid_cmd.add_argument("--date", default=None, help="UTC date YYYY-MM-DD (default: today)")
    run_hybrid_cmd.add_argument("--skip-discovery", action="store_true", help="Reuse internal approved links snapshot")
    run_hybrid_cmd.set_defaults(func=_cmd_run_hybrid)

    run_baseline_cmd = subparsers.add_parser("run-baseline", help="Run full baseline ingestion for all approved TLDs")
    _add_common_flags(run_baseline_cmd)
    run_baseline_cmd.add_argument("--date", default=None, help="Baseline UTC date YYYY-MM-DD (default: resume date or today)")
    run_baseline_cmd.add_argument("--resume", action="store_true", help="Resume from existing baseline day file")
    run_baseline_cmd.add_argument("--skip-discovery", action="store_true", help="Reuse internal approved links snapshot")
    run_baseline_cmd.set_defaults(func=_cmd_run_baseline)

    baseline_status_cmd = subparsers.add_parser("baseline-status", help="Show baseline completion status")
    _add_common_flags(baseline_status_cmd)
    baseline_status_cmd.add_argument("--date", default=None, help="UTC date YYYY-MM-DD (default: today)")
    baseline_status_cmd.set_defaults(func=_cmd_baseline_status)

    compute_signals = subparsers.add_parser("compute-signals", help="Recompute signals from aggregate outputs")
    _add_common_flags(compute_signals)
    compute_signals.add_argument("--date", required=True, help="UTC date YYYY-MM-DD")
    compute_signals.set_defaults(func=_cmd_compute_signals)

    rag = subparsers.add_parser("rag", help="RAG index utilities")
    rag_sub = rag.add_subparsers(dest="rag_command", required=True)
    rag_build = rag_sub.add_parser("build", help="Build or refresh the RAG index")
    rag_build.set_defaults(func=_cmd_rag_build)
    rag_build_static = rag_sub.add_parser("build-static", help="Build committed static RAG artifacts under data/rag/")
    rag_build_static.set_defaults(func=_cmd_rag_build_static)
    rag_search = rag_sub.add_parser("search", help="Search the RAG index")
    rag_search.add_argument("query")
    rag_search.add_argument("--k", type=int, default=8)
    rag_search.set_defaults(func=_cmd_rag_search)

    mcp = subparsers.add_parser("mcp", help="MCP server commands")
    mcp_sub = mcp.add_subparsers(dest="mcp_command", required=True)
    mcp_serve = mcp_sub.add_parser("serve", help="Run the RootFetch MCP server")
    mcp_serve.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    mcp_serve.add_argument("--port", type=int, default=8000)
    mcp_serve.set_defaults(func=_cmd_mcp_serve)

    alerts = subparsers.add_parser("alerts", help="Alerting utilities")
    alerts_sub = alerts.add_subparsers(dest="alerts_command", required=True)
    alerts_run = alerts_sub.add_parser("run", help="Evaluate and send RootFetch alerts")
    _add_common_flags(alerts_run)
    alerts_run.add_argument("--date", default=None, help="UTC date YYYY-MM-DD (default: today)")
    alerts_run.set_defaults(func=_cmd_alerts_run)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
