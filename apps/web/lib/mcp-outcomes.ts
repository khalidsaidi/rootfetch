import { z } from "zod";

import type { RunScopedBundle } from "@/lib/rootfetch-data";

const SHA256_RE = /^[a-f0-9]{64}$/i;

const ToolArtifactUrlsSchema = z.object({
  manifest: z.string(),
  model: z.string(),
  coverage: z.string(),
  signals: z.string(),
  treemap: z.string(),
  radar: z.string(),
  digest: z.string(),
});

const EvidenceSchema = z.object({
  run_id: z.string().min(1),
  run_url: z.string().min(1),
  manifest_url: z.string().min(1),
  manifest_sha256: z.string().regex(SHA256_RE),
  model_version: z.string().min(1),
  snapshot_ts_utc: z.string().min(1),
  artifact_urls: ToolArtifactUrlsSchema,
});

const CurrentStateOutcomeSchema = z.object({
  outcome: z.literal("current_state"),
  schema_version: z.literal("1.0"),
  generated_at_utc: z.string(),
  run_id: z.string().min(1),
  regime: z.object({
    state: z.string().min(1),
    confidence: z.number(),
    dvi_score: z.number(),
    dvi_band: z.string().min(1),
  }),
  concentration: z.object({
    top10_share_pct: z.number(),
    top3_share_pct: z.number(),
    hhi: z.number(),
  }),
  coverage: z.object({
    approved_tlds_count: z.number(),
    counted_ever_count: z.number(),
    missing_ever_count: z.number(),
    coverage_pct: z.number(),
  }),
  volatility: z.object({
    total_delegated_today: z.number(),
    delta_7d_abs: z.number(),
    delta_7d_pct: z.number(),
    anomaly_rows: z.number(),
  }),
  top_anomalies: z.array(
    z.object({
      tld: z.string(),
      delta_abs: z.number(),
      delta_pct: z.number(),
      robust_z: z.number().nullable(),
      anomaly_score: z.number().nullable(),
      sector: z.string(),
    }),
  ),
  evidence: EvidenceSchema,
});

const RunDeltaOutcomeSchema = z.object({
  outcome: z.literal("run_delta"),
  schema_version: z.literal("1.0"),
  generated_at_utc: z.string(),
  left_run_id: z.string().min(1),
  right_run_id: z.string().min(1),
  transition: z.object({
    dvi_left: z.number(),
    dvi_right: z.number(),
    dvi_delta: z.number(),
    regime_left: z.string(),
    regime_right: z.string(),
    regime_changed: z.boolean(),
    confidence_left: z.number(),
    confidence_right: z.number(),
    confidence_delta: z.number(),
    model_version_left: z.string(),
    model_version_right: z.string(),
    model_changed: z.boolean(),
    model_transition_disclosure: z.string().nullable(),
  }),
  concentration_delta: z.object({
    top10_share_pct_left: z.number(),
    top10_share_pct_right: z.number(),
    top10_share_pct_delta: z.number(),
    top3_share_pct_delta: z.number(),
    hhi_delta: z.number(),
  }),
  coverage_delta: z.object({
    observed_today_delta: z.number(),
    core_today_delta: z.number(),
    rolling_today_delta: z.number(),
    missing_ever_delta: z.number(),
  }),
  temporal: z.object({
    left_snapshot_ts_utc: z.string(),
    right_snapshot_ts_utc: z.string(),
  }),
  compare: z.object({
    compare_url: z.string(),
    left_run_url: z.string(),
    right_run_url: z.string(),
  }),
  evidence: z.object({
    left: EvidenceSchema,
    right: EvidenceSchema,
  }),
});

const TldSpotlightOutcomeSchema = z.object({
  outcome: z.literal("tld_spotlight"),
  schema_version: z.literal("1.0"),
  generated_at_utc: z.string(),
  run_id: z.string().min(1),
  tld: z.string().min(1),
  metrics: z.object({
    count: z.number().nullable(),
    share_pct: z.number().nullable(),
    delta_abs: z.number().nullable(),
    delta_pct: z.number().nullable(),
    delta_7d_abs: z.number().nullable(),
    delta_30d_abs: z.number().nullable(),
    anomaly_score: z.number().nullable(),
    sector: z.string().nullable(),
  }),
  signals: z.object({
    in_top_tlds: z.boolean(),
    in_market_map: z.boolean(),
    in_anomaly_spotlight: z.boolean(),
    anomaly_label: z.string().nullable(),
    anomaly_intensity: z.string().nullable(),
  }),
  links: z.object({
    run_url: z.string(),
    tld_url: z.string(),
    compare_to_latest_url: z.string(),
  }),
  evidence: EvidenceSchema,
});

const AlertCandidateSchema = z.object({
  tld: z.string(),
  category: z.enum(["anomaly", "mover"]),
  count: z.number(),
  delta_abs: z.number(),
  delta_pct: z.number(),
  robust_z: z.number().nullable(),
  anomaly_score: z.number().nullable(),
  sector: z.string().nullable(),
  reason: z.string(),
});

const AlertCandidatesOutcomeSchema = z.object({
  outcome: z.literal("alert_candidates"),
  schema_version: z.literal("1.0"),
  generated_at_utc: z.string(),
  run_id: z.string().min(1),
  limit: z.number(),
  total_candidates: z.number(),
  triggers: z.object({
    dvi_score: z.number(),
    dvi_band: z.string(),
    regime: z.string(),
    concentration_top10_share_pct: z.number(),
  }),
  candidates: z.array(AlertCandidateSchema),
  evidence: EvidenceSchema,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeTld(raw: string): string {
  const base = String(raw || "").trim().toLowerCase();
  if (!base) return "";
  return base.startsWith(".") ? base : `.${base}`;
}

function artifactUrlsForRun(runId: string): z.infer<typeof ToolArtifactUrlsSchema> {
  const enc = encodeURIComponent(runId);
  const base = `/rootfetch/artifacts/runs/${enc}`;
  return {
    manifest: `${base}/manifest.json`,
    model: `${base}/model_latest.json`,
    coverage: `${base}/coverage_latest.json`,
    signals: `${base}/signals_latest.json`,
    treemap: `${base}/treemap_latest.json`,
    radar: `${base}/radar_latest.json`,
    digest: `${base}/digest_latest.txt`,
  };
}

export function buildEvidenceForRun(runId: string, bundle: RunScopedBundle): z.infer<typeof EvidenceSchema> {
  const manifest = asRecord(bundle.manifest);
  const model = asRecord(bundle.model);
  const manifestSha = String(bundle.manifestSha256 || "").trim();
  if (!SHA256_RE.test(manifestSha)) {
    throw new Error("invalid_manifest_sha256");
  }

  const snapshotTs = asString(manifest.snapshot_ts_utc, asString(bundle.signals.date_utc, "n/a"));
  const modelVersion = asString(model.model_version, asString(manifest.model_version, "unknown"));

  return EvidenceSchema.parse({
    run_id: runId,
    run_url: `/runs/${encodeURIComponent(runId)}`,
    manifest_url: artifactUrlsForRun(runId).manifest,
    manifest_sha256: manifestSha,
    model_version: modelVersion || "unknown",
    snapshot_ts_utc: snapshotTs || "n/a",
    artifact_urls: artifactUrlsForRun(runId),
  });
}

export function buildCurrentStateOutcome(runId: string, bundle: RunScopedBundle): z.infer<typeof CurrentStateOutcomeSchema> {
  const model = asRecord(bundle.model);
  const concentration = asRecord(bundle.signals.concentration);
  const pulse = asRecord(bundle.signals.pulse);
  const approved = asNumber(bundle.coverage.approved_tlds_count);
  const countedEver = asNumber(bundle.coverage.counted_ever_count);
  const missingEver = asNumber(bundle.coverage.missing_ever_count, Math.max(0, approved - countedEver));
  const coveragePct = approved > 0 ? countedEver / approved : 0;

  const topAnomalies = asArray(bundle.signals.anomaly_spotlight)
    .slice(0, 8)
    .map((row) => ({
      tld: asString(row.tld, "unknown"),
      delta_abs: asNumber(row.delta_abs),
      delta_pct: asNumber(row.delta_pct),
      robust_z: row.robust_z == null ? null : asNumber(row.robust_z),
      anomaly_score: row.anomaly_score == null ? null : asNumber(row.anomaly_score),
      sector: asString(row.sector, "other"),
    }));

  return CurrentStateOutcomeSchema.parse({
    outcome: "current_state",
    schema_version: "1.0",
    generated_at_utc: new Date().toISOString(),
    run_id: runId,
    regime: {
      state: asString(model.regime, "UNKNOWN").toUpperCase(),
      confidence: asNumber(model.regime_confidence),
      dvi_score: asNumber(asRecord(model.dvi).score, asNumber(bundle.signals.dvi?.score)),
      dvi_band: asString(model.dvi_band, asString(asRecord(bundle.signals).dvi_band, "stable")).toLowerCase(),
    },
    concentration: {
      top10_share_pct: asNumber(concentration.top10_share_pct),
      top3_share_pct: asNumber(concentration.top3_share_pct),
      hhi: asNumber(concentration.hhi),
    },
    coverage: {
      approved_tlds_count: approved,
      counted_ever_count: countedEver,
      missing_ever_count: missingEver,
      coverage_pct: coveragePct,
    },
    volatility: {
      total_delegated_today: asNumber(pulse.total_delegated_today, asNumber(bundle.signals.total_delegated_counted_today)),
      delta_7d_abs: asNumber(pulse.rolling_7d_delta_abs),
      delta_7d_pct: asNumber(pulse.rolling_7d_delta_pct),
      anomaly_rows: topAnomalies.length,
    },
    top_anomalies: topAnomalies,
    evidence: buildEvidenceForRun(runId, bundle),
  });
}

export function buildRunDeltaOutcome(
  leftRunId: string,
  leftBundle: RunScopedBundle,
  rightRunId: string,
  rightBundle: RunScopedBundle,
): z.infer<typeof RunDeltaOutcomeSchema> {
  const leftModel = asRecord(leftBundle.model);
  const rightModel = asRecord(rightBundle.model);

  const leftDvi = asNumber(asRecord(leftModel.dvi).score, asNumber(leftBundle.signals.dvi?.score));
  const rightDvi = asNumber(asRecord(rightModel.dvi).score, asNumber(rightBundle.signals.dvi?.score));
  const leftRegime = asString(leftModel.regime, "UNKNOWN").toUpperCase();
  const rightRegime = asString(rightModel.regime, "UNKNOWN").toUpperCase();
  const leftConfidence = asNumber(leftModel.regime_confidence);
  const rightConfidence = asNumber(rightModel.regime_confidence);

  const leftVersion = asString(leftModel.model_version, "unknown");
  const rightVersion = asString(rightModel.model_version, "unknown");
  const modelChanged = leftVersion !== rightVersion;
  const regimeChanged = leftRegime !== rightRegime;

  const leftConcentration = asRecord(leftBundle.signals.concentration);
  const rightConcentration = asRecord(rightBundle.signals.concentration);

  return RunDeltaOutcomeSchema.parse({
    outcome: "run_delta",
    schema_version: "1.0",
    generated_at_utc: new Date().toISOString(),
    left_run_id: leftRunId,
    right_run_id: rightRunId,
    transition: {
      dvi_left: leftDvi,
      dvi_right: rightDvi,
      dvi_delta: rightDvi - leftDvi,
      regime_left: leftRegime,
      regime_right: rightRegime,
      regime_changed: regimeChanged,
      confidence_left: leftConfidence,
      confidence_right: rightConfidence,
      confidence_delta: rightConfidence - leftConfidence,
      model_version_left: leftVersion,
      model_version_right: rightVersion,
      model_changed: modelChanged,
      model_transition_disclosure:
        modelChanged && regimeChanged ? "Change attributed to model_version transition." : null,
    },
    concentration_delta: {
      top10_share_pct_left: asNumber(leftConcentration.top10_share_pct),
      top10_share_pct_right: asNumber(rightConcentration.top10_share_pct),
      top10_share_pct_delta:
        asNumber(rightConcentration.top10_share_pct) - asNumber(leftConcentration.top10_share_pct),
      top3_share_pct_delta:
        asNumber(rightConcentration.top3_share_pct) - asNumber(leftConcentration.top3_share_pct),
      hhi_delta: asNumber(rightConcentration.hhi) - asNumber(leftConcentration.hhi),
    },
    coverage_delta: {
      observed_today_delta:
        asNumber(rightBundle.signals.counted_today_count) - asNumber(leftBundle.signals.counted_today_count),
      core_today_delta:
        asNumber(rightBundle.coverage.counted_today_core_count) - asNumber(leftBundle.coverage.counted_today_core_count),
      rolling_today_delta:
        asNumber(rightBundle.coverage.counted_today_rolling_count) -
        asNumber(leftBundle.coverage.counted_today_rolling_count),
      missing_ever_delta:
        asNumber(rightBundle.coverage.missing_ever_count) - asNumber(leftBundle.coverage.missing_ever_count),
    },
    temporal: {
      left_snapshot_ts_utc: asString(asRecord(leftBundle.manifest).snapshot_ts_utc, leftBundle.signals.date_utc || "n/a"),
      right_snapshot_ts_utc: asString(asRecord(rightBundle.manifest).snapshot_ts_utc, rightBundle.signals.date_utc || "n/a"),
    },
    compare: {
      compare_url: `/compare?left=${encodeURIComponent(leftRunId)}&right=${encodeURIComponent(rightRunId)}`,
      left_run_url: `/runs/${encodeURIComponent(leftRunId)}`,
      right_run_url: `/runs/${encodeURIComponent(rightRunId)}`,
    },
    evidence: {
      left: buildEvidenceForRun(leftRunId, leftBundle),
      right: buildEvidenceForRun(rightRunId, rightBundle),
    },
  });
}

export function buildTldSpotlightOutcome(
  runId: string,
  bundle: RunScopedBundle,
  tldInput: string,
): z.infer<typeof TldSpotlightOutcomeSchema> {
  const tld = normalizeTld(tldInput);
  if (!tld) {
    throw new Error("invalid_tld");
  }

  const marketMapRows = asArray(bundle.signals.market_map);
  const topRows = asArray(bundle.signals.top_tlds);
  const anomalyRows = asArray(bundle.signals.anomaly_spotlight);

  const marketRow = marketMapRows.find((row) => normalizeTld(asString(row.tld)) === tld);
  const topRow = topRows.find((row) => normalizeTld(asString(row.tld)) === tld);
  const anomalyRow = anomalyRows.find((row) => normalizeTld(asString(row.tld)) === tld);

  return TldSpotlightOutcomeSchema.parse({
    outcome: "tld_spotlight",
    schema_version: "1.0",
    generated_at_utc: new Date().toISOString(),
    run_id: runId,
    tld,
    metrics: {
      count: marketRow ? asNumber(marketRow.count) : topRow ? asNumber(topRow.count) : null,
      share_pct: marketRow ? asNumber(marketRow.share_pct) : topRow ? asNumber(topRow.share_pct) : null,
      delta_abs: marketRow ? asNumber(marketRow.delta_abs) : null,
      delta_pct: marketRow ? asNumber(marketRow.delta_pct) : null,
      delta_7d_abs: marketRow ? asNumber(marketRow.delta_7d_abs) : null,
      delta_30d_abs: marketRow ? asNumber(marketRow.delta_30d_abs) : null,
      anomaly_score:
        marketRow && marketRow.anomaly_score != null
          ? asNumber(marketRow.anomaly_score)
          : anomalyRow && anomalyRow.anomaly_score != null
            ? asNumber(anomalyRow.anomaly_score)
            : null,
      sector: asString(marketRow?.sector ?? topRow?.sector ?? anomalyRow?.sector ?? null, ""),
    },
    signals: {
      in_top_tlds: Boolean(topRow),
      in_market_map: Boolean(marketRow),
      in_anomaly_spotlight: Boolean(anomalyRow),
      anomaly_label: anomalyRow ? asString(anomalyRow.label, "signal") : null,
      anomaly_intensity: anomalyRow ? asString(anomalyRow.intensity, "") || null : null,
    },
    links: {
      run_url: `/runs/${encodeURIComponent(runId)}`,
      tld_url: `/tld/${encodeURIComponent(tld.replace(/^\./, ""))}`,
      compare_to_latest_url: `/compare?left=${encodeURIComponent(runId)}&right=latest`,
    },
    evidence: buildEvidenceForRun(runId, bundle),
  });
}

export function buildAlertCandidatesOutcome(
  runId: string,
  bundle: RunScopedBundle,
  limitRaw: number,
): z.infer<typeof AlertCandidatesOutcomeSchema> {
  const limit = Math.max(1, Math.min(50, Math.floor(limitRaw || 10)));
  const anomalyRows = asArray(bundle.signals.anomaly_spotlight);
  const moverRows = asArray(bundle.signals.top_movers_abs);

  const candidates = [
    ...anomalyRows.map((row) => ({
      tld: asString(row.tld, "unknown"),
      category: "anomaly" as const,
      count: asNumber(row.count),
      delta_abs: asNumber(row.delta_abs),
      delta_pct: asNumber(row.delta_pct),
      robust_z: row.robust_z == null ? null : asNumber(row.robust_z),
      anomaly_score: row.anomaly_score == null ? null : asNumber(row.anomaly_score),
      sector: asString(row.sector, "") || null,
      reason: asString(row.label, "anomaly_spotlight"),
    })),
    ...moverRows.map((row) => ({
      tld: asString(row.tld, "unknown"),
      category: "mover" as const,
      count: asNumber(row.count),
      delta_abs: asNumber(row.delta_abs),
      delta_pct: asNumber(row.delta_pct),
      robust_z: null,
      anomaly_score: null,
      sector: null,
      reason: "top_movers_abs",
    })),
  ]
    .sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs))
    .slice(0, limit);

  const model = asRecord(bundle.model);
  const concentration = asRecord(bundle.signals.concentration);
  return AlertCandidatesOutcomeSchema.parse({
    outcome: "alert_candidates",
    schema_version: "1.0",
    generated_at_utc: new Date().toISOString(),
    run_id: runId,
    limit,
    total_candidates: candidates.length,
    triggers: {
      dvi_score: asNumber(asRecord(model.dvi).score, asNumber(bundle.signals.dvi?.score)),
      dvi_band: asString(model.dvi_band, asString(asRecord(bundle.signals).dvi_band, "stable")).toLowerCase(),
      regime: asString(model.regime, "UNKNOWN").toUpperCase(),
      concentration_top10_share_pct: asNumber(concentration.top10_share_pct),
    },
    candidates,
    evidence: buildEvidenceForRun(runId, bundle),
  });
}
