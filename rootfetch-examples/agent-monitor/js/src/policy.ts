type UnknownRecord = Record<string, unknown>;

export type RunSnapshot = {
  run_id: string;
  snapshot_ts_utc: string;
  model_version: string;
  regime: string;
  regime_confidence: number;
  dvi: number;
  top_mover_tld: string | null;
  top_mover_delta_abs: number;
  top_mover_z: number | null;
};

export type PolicyAlert = {
  policy_id: "regime_transition" | "dvi_threshold" | "top_mover_anomaly";
  severity: "info" | "warning" | "high";
  summary: string;
  details: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function topMoverFromSignals(signals: UnknownRecord): { tld: string | null; delta_abs: number; z: number | null } {
  const moversRaw = Array.isArray(signals.top_movers_abs)
    ? signals.top_movers_abs
    : Array.isArray(signals.core_movers_abs)
      ? signals.core_movers_abs
      : [];
  const firstMover = moversRaw.length > 0 ? asRecord(moversRaw[0]) : {};
  const tld = asString(firstMover.tld, "") || null;
  const deltaAbs = asNumber(firstMover.delta_abs);

  const spotlightRaw = Array.isArray(signals.anomaly_spotlight) ? signals.anomaly_spotlight : [];
  const zValues = spotlightRaw
    .map((row) => {
      const entry = asRecord(row);
      const robustZ = entry.robust_z;
      const zScore = entry.z_score;
      const candidate = robustZ ?? zScore;
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? Math.abs(parsed) : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a);

  return {
    tld,
    delta_abs: deltaAbs,
    z: zValues[0] ?? null,
  };
}

export function buildRunSnapshot(
  runId: string,
  latestPointer: UnknownRecord,
  runBundle: UnknownRecord,
): RunSnapshot {
  const manifest = asRecord(runBundle.manifest);
  const artifacts = asRecord(runBundle.artifacts);
  const model = asRecord(artifacts["model_latest.json"]);
  const signals = asRecord(artifacts["signals_latest.json"]);
  const dviObj = asRecord(model.dvi);
  const topMover = topMoverFromSignals(signals);

  return {
    run_id: runId,
    snapshot_ts_utc: asString(manifest.snapshot_ts_utc, asString(latestPointer.snapshot_ts_utc, "n/a")),
    model_version: asString(model.model_version, asString(latestPointer.model_version, "n/a")),
    regime: asString(model.regime, "UNKNOWN").toUpperCase(),
    regime_confidence: asNumber(model.regime_confidence),
    dvi: asNumber(dviObj.score),
    top_mover_tld: topMover.tld,
    top_mover_delta_abs: topMover.delta_abs,
    top_mover_z: topMover.z,
  };
}

export function evaluatePolicies({
  current,
  previous,
  dviThreshold,
  topMoverZThreshold,
}: {
  current: RunSnapshot;
  previous: RunSnapshot | null;
  dviThreshold: number;
  topMoverZThreshold: number;
}): PolicyAlert[] {
  const alerts: PolicyAlert[] = [];

  if (previous && previous.regime !== current.regime) {
    alerts.push({
      policy_id: "regime_transition",
      severity: "info",
      summary: `Regime transition ${previous.regime} -> ${current.regime}`,
      details: `Run ${current.run_id} changed regime from ${previous.regime} to ${current.regime}.`,
    });
  }

  if (current.dvi >= dviThreshold) {
    alerts.push({
      policy_id: "dvi_threshold",
      severity: current.dvi >= Math.max(75, dviThreshold + 10) ? "high" : "warning",
      summary: `DVI threshold exceeded (${current.dvi.toFixed(1)} >= ${dviThreshold.toFixed(1)})`,
      details: `Run ${current.run_id} has DVI ${current.dvi.toFixed(1)} with regime ${current.regime}.`,
    });
  }

  if (current.top_mover_z !== null && current.top_mover_z >= topMoverZThreshold) {
    alerts.push({
      policy_id: "top_mover_anomaly",
      severity: current.top_mover_z >= topMoverZThreshold + 1 ? "high" : "warning",
      summary: `Top mover anomaly .${current.top_mover_tld || "unknown"} z=${current.top_mover_z.toFixed(2)}`,
      details: `Top mover delta_abs ${current.top_mover_delta_abs} with z-score ${current.top_mover_z.toFixed(2)} in run ${current.run_id}.`,
    });
  }

  return alerts;
}

