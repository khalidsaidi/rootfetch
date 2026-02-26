from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


def _record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_str(value: Any, default: str = "") -> str:
    if not isinstance(value, str):
        return default
    out = value.strip()
    return out or default


def _as_num(value: Any) -> float:
    try:
        out = float(value)
    except Exception:
        return 0.0
    return out if out == out else 0.0


@dataclass(frozen=True)
class RunSnapshot:
    run_id: str
    snapshot_ts_utc: str
    model_version: str
    regime: str
    regime_confidence: float
    dvi: float
    top_mover_tld: Optional[str]
    top_mover_delta_abs: float
    top_mover_z: Optional[float]


@dataclass(frozen=True)
class PolicyAlert:
    policy_id: str
    severity: str
    summary: str
    details: str


def _top_mover(signals: Dict[str, Any]) -> tuple[Optional[str], float, Optional[float]]:
    movers = signals.get("top_movers_abs")
    if not isinstance(movers, list) or not movers:
        movers = signals.get("core_movers_abs")
    first = _record(movers[0]) if isinstance(movers, list) and movers else {}
    tld = _as_str(first.get("tld"), "") or None
    delta_abs = _as_num(first.get("delta_abs"))

    spotlight = signals.get("anomaly_spotlight")
    z_values: List[float] = []
    if isinstance(spotlight, list):
        for row in spotlight:
            rec = _record(row)
            raw = rec.get("robust_z")
            if raw is None:
                raw = rec.get("z_score")
            if raw is None:
                continue
            val = abs(_as_num(raw))
            if val > 0:
                z_values.append(val)
    z_values.sort(reverse=True)
    top_z = z_values[0] if z_values else None
    return tld, delta_abs, top_z


def build_run_snapshot(run_id: str, latest_pointer: Dict[str, Any], run_bundle: Dict[str, Any]) -> RunSnapshot:
    manifest = _record(run_bundle.get("manifest"))
    artifacts = _record(run_bundle.get("artifacts"))
    model = _record(artifacts.get("model_latest.json"))
    signals = _record(artifacts.get("signals_latest.json"))
    dvi_obj = _record(model.get("dvi"))
    tld, delta_abs, top_z = _top_mover(signals)

    return RunSnapshot(
        run_id=run_id,
        snapshot_ts_utc=_as_str(manifest.get("snapshot_ts_utc"), _as_str(latest_pointer.get("snapshot_ts_utc"), "n/a")),
        model_version=_as_str(model.get("model_version"), _as_str(latest_pointer.get("model_version"), "n/a")),
        regime=_as_str(model.get("regime"), "UNKNOWN").upper(),
        regime_confidence=_as_num(model.get("regime_confidence")),
        dvi=_as_num(dvi_obj.get("score")),
        top_mover_tld=tld,
        top_mover_delta_abs=delta_abs,
        top_mover_z=top_z,
    )


def evaluate_policies(
    current: RunSnapshot,
    previous: Optional[RunSnapshot],
    dvi_threshold: float,
    top_mover_z_threshold: float,
) -> List[PolicyAlert]:
    alerts: List[PolicyAlert] = []

    if previous and previous.regime != current.regime:
        alerts.append(
            PolicyAlert(
                policy_id="regime_transition",
                severity="info",
                summary=f"Regime transition {previous.regime} -> {current.regime}",
                details=f"Run {current.run_id} changed regime from {previous.regime} to {current.regime}.",
            )
        )

    if current.dvi >= dvi_threshold:
        severity = "high" if current.dvi >= max(75.0, dvi_threshold + 10.0) else "warning"
        alerts.append(
            PolicyAlert(
                policy_id="dvi_threshold",
                severity=severity,
                summary=f"DVI threshold exceeded ({current.dvi:.1f} >= {dvi_threshold:.1f})",
                details=f"Run {current.run_id} has DVI {current.dvi:.1f} with regime {current.regime}.",
            )
        )

    if current.top_mover_z is not None and current.top_mover_z >= top_mover_z_threshold:
        severity = "high" if current.top_mover_z >= top_mover_z_threshold + 1.0 else "warning"
        alerts.append(
            PolicyAlert(
                policy_id="top_mover_anomaly",
                severity=severity,
                summary=f"Top mover anomaly .{current.top_mover_tld or 'unknown'} z={current.top_mover_z:.2f}",
                details=(
                    f"Top mover delta_abs {current.top_mover_delta_abs:.0f} with z-score "
                    f"{current.top_mover_z:.2f} in run {current.run_id}."
                ),
            )
        )

    return alerts

