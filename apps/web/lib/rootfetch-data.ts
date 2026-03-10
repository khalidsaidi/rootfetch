import { existsSync, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export type LatestSignals = {
  date_utc: string;
  run_id: string;
  model_version?: string;
  methodology_version?: string;
  approved_tlds_count: number;
  counted_today_count: number;
  counted_today_core_count: number;
  counted_today_rolling_count: number;
  snapshot_rows_today: number;
  processed_tlds_count_today?: number;
  coverage_pct_today: number;
  note_if_partial?: string;
  total_delegated_counted_today?: number;
  total_delegated_domains_today?: number;
  top_tlds?: Array<{ tld: string; count: number; share_pct: number; sector: string; cadence?: string }>;
  distribution?: {
    p50?: number;
    p90?: number;
    p99?: number;
    max?: number;
    min?: number;
    tiny_tlds_lt_100?: number;
    small_tlds_lt_1000?: number;
  };
  concentration?: {
    top1_share_pct?: number;
    top3_share_pct?: number;
    top10_share_pct?: number;
    hhi?: number;
  };
  approvals_diff?: {
    prev_date_utc?: string;
    added_count?: number;
    removed_count?: number;
    added_preview?: string[];
    added_first_10?: string[];
  };
  pulse?: {
    total_delegated_today?: number;
    delta_abs_today?: number;
    delta_pct_today?: number;
    rolling_7d_delta_abs?: number;
    rolling_7d_delta_pct?: number;
    series_30d?: Array<{ date_utc: string; total_delegated_count: number }>;
  };
  dvi?: {
    score?: number;
    level?: string;
    dispersion_component?: number;
    anomaly_component?: number;
    top10_shift_component?: number;
    inputs?: {
      std_abs_delta?: number;
      anomaly_count?: number;
      max_abs_robust_z?: number;
      top10_turnover_pct?: number;
    };
  };
  anomaly_spotlight?: Array<{
    tld: string;
    count: number;
    delta_abs: number;
    delta_pct: number;
    z_score?: number;
    robust_z?: number;
    anomaly_score?: number;
    volatility?: number;
    sector?: string;
    cadence?: string;
    label?: string;
    intensity?: string;
  }>;
  market_map?: Array<{
    tld: string;
    count: number;
    share_pct: number;
    delta_abs: number;
    delta_pct: number;
    delta_7d_abs?: number;
    delta_30d_abs?: number;
    delta_7d_pct?: number;
    delta_30d_pct?: number;
    anomaly_score?: number;
    sector?: string;
    cadence?: string;
  }>;
  power_curve?: {
    today?: Array<{ rank: number; tld: string; count: number }>;
    d30?: Array<{ rank: number; tld: string; count: number }>;
    d90?: Array<{ rank: number; tld: string; count: number }>;
    date_utc_today?: string;
    date_utc_d30?: string;
    date_utc_d90?: string;
  };
  radar_points?: Array<{
    tld: string;
    growth_pct: number;
    volatility?: number;
    anomaly_score?: number;
    count: number;
    sector?: string;
    cadence?: string;
  }>;
  sector_indices?: Array<{
    sector: string;
    total_delegated: number;
    delta_7d_pct?: number;
    delta_30d_pct?: number;
    volatility?: number;
    series_30d?: Array<{ date_utc: string; sector_count: number }>;
  }>;
  market_risk?: {
    concentration_risk?: string;
    concentration_score?: number;
    top10_share_pct?: number;
    top3_share_pct?: number;
    hhi?: number;
    fragmentation?: string;
    tiny_tld_saturation_trend?: string;
    core_dominance?: string;
  };
  insights?: Array<{ kind: string; severity: string; text: string }>;
  security_status?: {
    date_utc?: string;
    checked_at_utc?: string;
    no_raw_zones_tracked?: boolean;
    no_ai_dir_tracked?: boolean;
    no_env_tracked?: boolean;
    last_local_run_id?: string;
    runtime_read_only?: boolean;
    runtime_platform?: string;
  };
  top_movers_abs?: Array<{ tld: string; count: number; delta_abs: number; delta_pct: number }>;
  top_movers_pct?: Array<{ tld: string; count: number; delta_abs: number; delta_pct: number }>;
  core_movers_abs?: Array<{ tld: string; count: number; delta_abs: number; delta_pct: number }>;
  core_movers_pct?: Array<{ tld: string; count: number; delta_abs: number; delta_pct: number }>;
  rolling_updates?: Array<{
    tld: string;
    count: number;
    prev_date_utc: string;
    days_since_prev: number;
    delta_abs: number;
    delta_pct?: number;
    cadence?: string;
    status?: string;
    is_first_seen?: boolean;
  }>;
  anomalies?: Array<{ tld: string; reason: string; delta_pct: number; z: number; robust_z: number }>;
  sector_snapshot?: Array<{ sector: string; sector_count: number; sector_delta_pct?: number }>;
};

export type CoverageLatest = {
  date_utc: string;
  approved_tlds_count: number;
  approved_tlds: string[];
  counted_today_tlds: string[];
  counted_today_count: number;
  counted_today_core_count?: number;
  counted_today_rolling_count?: number;
  counted_ever_tlds: string[];
  counted_ever_count: number;
  missing_ever_tlds: string[];
  missing_ever_count: number;
  last_seen_by_tld?: Record<string, string>;
};

export type ApprovedLatest = {
  date_utc: string;
  fetched_at_utc?: string;
  count: number;
  tlds: string[];
};

export type OpsScoreboard = {
  generated_at_utc: string;
  reference_now_utc: string;
  run_reliability: {
    latest_run_age_hours: number;
    runs_7d: number;
    runs_30d: number;
    max_gap_hours_7d: number;
    max_gap_hours_30d: number;
  };
  publication_cadence: {
    briefs_published_ytd: number;
    drills_logged_ytd: number;
  };
  adoption: {
    external_citations_logged_ytd: number;
    adoption_log_entries_ytd: number;
    note?: string;
  };
  targets_90d: {
    run_completion_rate_pct: number;
    design_partner_teams: number;
    external_citations: number;
    weekly_active_mcp_clients: number;
  };
};

export type ArtifactLatestPointer = {
  run_id: string;
  snapshot_ts_utc?: string;
  snapshot_utc_day?: string;
  snapshot_hash?: string;
  model_version?: string;
  methodology_version?: string;
  coverage?: {
    approved_tlds_count?: number;
    counted_ever_count?: number;
    missing_ever_count?: number;
    counted_today_core_count?: number;
    counted_today_rolling_count?: number;
  };
};

export type ReplayRunEntry = {
  run_id: string;
  snapshot_ts_utc?: string;
  snapshot_utc_day?: string;
  snapshot_hash?: string;
  model_version?: string;
  dvi?: {
    score?: number;
    level?: string;
  };
  regime?: string;
  regime_confidence?: number;
};

export type ReplayIndexArtifact = {
  runs: ReplayRunEntry[];
};

export type PublishedRunBundle = {
  pointer: ArtifactLatestPointer;
  signals: LatestSignals;
  coverage: CoverageLatest;
  model: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestSha256: string;
};

export type RunManifestFile = {
  path: string;
  size?: number;
  sha256?: string;
};

export type RunManifest = {
  run_id?: string;
  model_version?: string;
  snapshot_hash?: string;
  snapshot_ts_utc?: string;
  snapshot_utc_day?: string;
  files?: RunManifestFile[];
};

export type RunScopedBundle = {
  runId: string;
  baseHref: string;
  manifest: RunManifest;
  manifestSha256: string;
  model: Record<string, unknown>;
  coverage: CoverageLatest;
  signals: LatestSignals;
  digest: string | null;
  expectedCount: number;
  checkedCount: number;
  missingPaths: string[];
};

export type RunCompareBundle = {
  runId: string;
  baseHref: string;
  manifest: RunManifest;
  manifestSha256: string;
  model: Record<string, unknown>;
  coverage: CoverageLatest;
  signals: LatestSignals;
  missingPaths: string[];
  degraded: boolean;
};

export type CsvRow = Record<string, string>;

const ROOTFETCH_PUBLIC_CANDIDATES = Array.from(
  new Set([
    path.join(process.cwd(), "public", "rootfetch"),
    path.join(process.cwd(), "apps", "web", "public", "rootfetch"),
    path.join(process.cwd(), "..", "public", "rootfetch"),
  ]),
);

const ROOTFETCH_PUBLIC =
  ROOTFETCH_PUBLIC_CANDIDATES.find((candidate) => existsSync(path.join(candidate, "latest.json"))) ||
  ROOTFETCH_PUBLIC_CANDIDATES.find((candidate) => existsSync(candidate)) ||
  ROOTFETCH_PUBLIC_CANDIDATES[0];

function toNumber(value: string | undefined): number {
  if (value === undefined || value === "") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseJsonArtifact<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const normalized = raw.replace(/\b-?Infinity\b/g, "null").replace(/\bNaN\b/g, "null");
    return JSON.parse(normalized) as T;
  }
}

export function parseCsv(raw: string): CsvRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        out.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    out.push(current);
    return out;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? "";
    });
    return row;
  });
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  const filePath = path.join(ROOTFETCH_PUBLIC, filename);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseJsonArtifact<T>(raw);
  } catch {
    return fallback;
  }
}

async function readJsonAbsolute<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseJsonArtifact<T>(raw);
  } catch {
    return fallback;
  }
}

function normalizeRunId(runId: string): string | null {
  const safeRunId = String(runId || "").trim();
  if (!safeRunId) {
    return null;
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(safeRunId)) {
    return null;
  }
  return safeRunId;
}

async function readCsv(filename: string): Promise<CsvRow[]> {
  const filePath = path.join(ROOTFETCH_PUBLIC, filename);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseCsv(raw);
  } catch {
    return [];
  }
}

export async function loadLatest(): Promise<LatestSignals> {
  return readJson<LatestSignals>("latest.json", {
    date_utc: "n/a",
    run_id: "n/a",
    approved_tlds_count: 0,
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    snapshot_rows_today: 0,
    coverage_pct_today: 0,
    top_tlds: [],
    distribution: {},
    concentration: {},
    approvals_diff: {},
    pulse: {},
    dvi: {},
    anomaly_spotlight: [],
    market_map: [],
    power_curve: { today: [], d30: [], d90: [] },
    radar_points: [],
    sector_indices: [],
    market_risk: {},
    insights: [],
    security_status: {},
    top_movers_abs: [],
    top_movers_pct: [],
    core_movers_abs: [],
    core_movers_pct: [],
    rolling_updates: [],
    anomalies: [],
    sector_snapshot: [],
  });
}

export async function loadPublishedRunBundle(): Promise<PublishedRunBundle | null> {
  const pointer = await readJson<ArtifactLatestPointer>("artifacts/latest.json", { run_id: "" });
  const runId = String(pointer.run_id || "").trim();
  if (!runId) {
    return null;
  }

  const runBase = path.join(ROOTFETCH_PUBLIC, "artifacts", "runs", runId);
  const signals = await readJsonAbsolute<LatestSignals>(path.join(runBase, "signals_latest.json"), {
    date_utc: "n/a",
    run_id: "n/a",
    approved_tlds_count: 0,
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    snapshot_rows_today: 0,
    coverage_pct_today: 0,
    top_tlds: [],
    distribution: {},
    concentration: {},
    approvals_diff: {},
    pulse: {},
    dvi: {},
    anomaly_spotlight: [],
    market_map: [],
    power_curve: { today: [], d30: [], d90: [] },
    radar_points: [],
    sector_indices: [],
    market_risk: {},
    insights: [],
    security_status: {},
    top_movers_abs: [],
    top_movers_pct: [],
    core_movers_abs: [],
    core_movers_pct: [],
    rolling_updates: [],
    anomalies: [],
    sector_snapshot: [],
  });
  const coverage = await readJsonAbsolute<CoverageLatest>(path.join(runBase, "coverage_latest.json"), {
    date_utc: "n/a",
    approved_tlds_count: 0,
    approved_tlds: [],
    counted_today_tlds: [],
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    counted_ever_tlds: [],
    counted_ever_count: 0,
    missing_ever_tlds: [],
    missing_ever_count: 0,
    last_seen_by_tld: {},
  });
  const model = await readJsonAbsolute<Record<string, unknown>>(path.join(runBase, "model_latest.json"), {});
  const manifestPath = path.join(runBase, "manifest.json");
  const manifest = await readJsonAbsolute<Record<string, unknown>>(manifestPath, {});
  let manifestSha256 = "";
  try {
    const rawManifest = await fs.readFile(manifestPath);
    manifestSha256 = createHash("sha256").update(rawManifest).digest("hex");
  } catch {
    manifestSha256 = "";
  }

  const isSignalsMissing = (signals.date_utc || "n/a") === "n/a";
  const isCoverageMissing = (coverage.date_utc || "n/a") === "n/a";
  if (isSignalsMissing || isCoverageMissing) {
    return null;
  }

  const anchoredSignals: LatestSignals = {
    ...signals,
    run_id: runId,
  };

  return {
    pointer,
    signals: anchoredSignals,
    coverage,
    model,
    manifest,
    manifestSha256,
  };
}

export async function loadArtifactLatestPointer(): Promise<ArtifactLatestPointer | null> {
  const pointer = await readJson<ArtifactLatestPointer>("artifacts/latest.json", { run_id: "" });
  return String(pointer.run_id || "").trim() ? pointer : null;
}

export async function loadReplayIndex(): Promise<ReplayIndexArtifact> {
  const replay = await readJson<ReplayIndexArtifact>("artifacts/replay/index.json", { runs: [] });
  return {
    runs: Array.isArray(replay.runs) ? replay.runs : [],
  };
}

export async function loadRunCompareBundleById(runId: string): Promise<RunCompareBundle | null> {
  const safeRunId = normalizeRunId(runId);
  if (!safeRunId) {
    return null;
  }

  const runBase = path.join(ROOTFETCH_PUBLIC, "artifacts", "runs", safeRunId);
  try {
    await fs.access(runBase);
  } catch {
    return null;
  }

  const manifestPath = path.join(runBase, "manifest.json");
  const modelPath = path.join(runBase, "model_latest.json");
  const coveragePath = path.join(runBase, "coverage_latest.json");
  const signalsPath = path.join(runBase, "signals_latest.json");

  const fallbackCoverage: CoverageLatest = {
    date_utc: "n/a",
    approved_tlds_count: 0,
    approved_tlds: [],
    counted_today_tlds: [],
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    counted_ever_tlds: [],
    counted_ever_count: 0,
    missing_ever_tlds: [],
    missing_ever_count: 0,
    last_seen_by_tld: {},
  };

  const fallbackSignals: LatestSignals = {
    date_utc: "n/a",
    run_id: safeRunId,
    approved_tlds_count: 0,
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    snapshot_rows_today: 0,
    coverage_pct_today: 0,
    top_tlds: [],
    distribution: {},
    concentration: {},
    approvals_diff: {},
    pulse: {},
    dvi: {},
    anomaly_spotlight: [],
    market_map: [],
    power_curve: { today: [], d30: [], d90: [] },
    radar_points: [],
    sector_indices: [],
    market_risk: {},
    insights: [],
    security_status: {},
    top_movers_abs: [],
    top_movers_pct: [],
    core_movers_abs: [],
    core_movers_pct: [],
    rolling_updates: [],
    anomalies: [],
    sector_snapshot: [],
  };

  const missingPaths: string[] = [];
  const readRequiredJson = async <T>(absolutePath: string, relativePath: string, fallback: T): Promise<T> => {
    try {
      const raw = await fs.readFile(absolutePath, "utf-8");
      return parseJsonArtifact<T>(raw);
    } catch {
      missingPaths.push(relativePath);
      return fallback;
    }
  };

  let manifestSha256 = "";
  let manifest: RunManifest = {};
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    manifestSha256 = createHash("sha256").update(raw).digest("hex");
    manifest = parseJsonArtifact<RunManifest>(raw);
  } catch {
    missingPaths.push("manifest.json");
  }
  const model = await readRequiredJson<Record<string, unknown>>(modelPath, "model_latest.json", {});
  const coverage = await readRequiredJson<CoverageLatest>(coveragePath, "coverage_latest.json", fallbackCoverage);
  const signals = await readRequiredJson<LatestSignals>(signalsPath, "signals_latest.json", fallbackSignals);

  return {
    runId: safeRunId,
    baseHref: `/rootfetch/artifacts/runs/${encodeURIComponent(safeRunId)}`,
    manifest,
    manifestSha256,
    model,
    coverage: {
      ...coverage,
      date_utc: coverage.date_utc || "n/a",
    },
    signals: {
      ...signals,
      run_id: safeRunId,
      date_utc: signals.date_utc || "n/a",
    },
    missingPaths: Array.from(new Set(missingPaths)).sort(),
    degraded: missingPaths.length > 0,
  };
}

export async function loadRunBundleById(runId: string): Promise<RunScopedBundle | null> {
  const safeRunId = normalizeRunId(runId);
  if (!safeRunId) {
    return null;
  }

  const runBase = path.join(ROOTFETCH_PUBLIC, "artifacts", "runs", safeRunId);
  const manifestPath = path.join(runBase, "manifest.json");
  const modelPath = path.join(runBase, "model_latest.json");
  const coveragePath = path.join(runBase, "coverage_latest.json");
  const signalsPath = path.join(runBase, "signals_latest.json");
  const digestPath = path.join(runBase, "digest_latest.txt");

  try {
    await fs.access(manifestPath);
    await fs.access(modelPath);
    await fs.access(coveragePath);
    await fs.access(signalsPath);
  } catch {
    return null;
  }

  const manifest = await readJsonAbsolute<RunManifest>(manifestPath, {});
  const manifestSha256 = createHash("sha256").update(await fs.readFile(manifestPath)).digest("hex");
  const model = await readJsonAbsolute<Record<string, unknown>>(modelPath, {});
  const coverage = await readJsonAbsolute<CoverageLatest>(coveragePath, {
    date_utc: "n/a",
    approved_tlds_count: 0,
    approved_tlds: [],
    counted_today_tlds: [],
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    counted_ever_tlds: [],
    counted_ever_count: 0,
    missing_ever_tlds: [],
    missing_ever_count: 0,
    last_seen_by_tld: {},
  });
  const signals = await readJsonAbsolute<LatestSignals>(signalsPath, {
    date_utc: "n/a",
    run_id: safeRunId,
    approved_tlds_count: 0,
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    snapshot_rows_today: 0,
    coverage_pct_today: 0,
  } as LatestSignals);

  if ((coverage.date_utc || "n/a") === "n/a" || (signals.date_utc || "n/a") === "n/a") {
    return null;
  }

  let digest: string | null = null;
  try {
    digest = await fs.readFile(digestPath, "utf-8");
  } catch {
    digest = null;
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const expectedCount = files.length;
  const hasSha = (value: string | undefined): boolean => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

  let checkedCount = 0;
  const missingPaths: string[] = [];

  await Promise.all(
    files.map(async (entry) => {
      const relPath = String(entry?.path || "").trim();
      if (!relPath) {
        return;
      }
      if (hasSha(entry.sha256)) {
        checkedCount += 1;
      }
      const absolute = path.join(runBase, relPath);
      try {
        await fs.access(absolute);
      } catch {
        missingPaths.push(relPath);
      }
    }),
  );

  return {
    runId: safeRunId,
    baseHref: `/rootfetch/artifacts/runs/${encodeURIComponent(safeRunId)}`,
    manifest,
    manifestSha256,
    model,
    coverage,
    signals: {
      ...signals,
      run_id: safeRunId,
    },
    digest,
    expectedCount,
    checkedCount,
    missingPaths: missingPaths.sort(),
  };
}

export async function loadCoverage(): Promise<CoverageLatest> {
  return readJson<CoverageLatest>("coverage_latest.json", {
    date_utc: "n/a",
    approved_tlds_count: 0,
    approved_tlds: [],
    counted_today_tlds: [],
    counted_today_count: 0,
    counted_today_core_count: 0,
    counted_today_rolling_count: 0,
    counted_ever_tlds: [],
    counted_ever_count: 0,
    missing_ever_tlds: [],
    missing_ever_count: 0,
    last_seen_by_tld: {},
  });
}

export async function loadApproved(): Promise<ApprovedLatest> {
  return readJson<ApprovedLatest>("approved_latest.json", {
    date_utc: "n/a",
    count: 0,
    tlds: [],
  });
}

export async function loadOpsScoreboard(): Promise<OpsScoreboard> {
  return readJson<OpsScoreboard>("ops_scoreboard_latest.json", {
    generated_at_utc: "n/a",
    reference_now_utc: "n/a",
    run_reliability: {
      latest_run_age_hours: 0,
      runs_7d: 0,
      runs_30d: 0,
      max_gap_hours_7d: 0,
      max_gap_hours_30d: 0,
    },
    publication_cadence: {
      briefs_published_ytd: 0,
      drills_logged_ytd: 0,
    },
    adoption: {
      external_citations_logged_ytd: 0,
      adoption_log_entries_ytd: 0,
      note: "",
    },
    targets_90d: {
      run_completion_rate_pct: 99,
      design_partner_teams: 10,
      external_citations: 30,
      weekly_active_mcp_clients: 10,
    },
  });
}

export async function loadTopTldsCsv(): Promise<Array<{ tld: string; count: number; share_pct: number; sector: string; cadence: string }>> {
  const rows = await readCsv("top_tlds_latest.csv");
  return rows.map((row) => ({
    tld: row.tld || "",
    count: toNumber(row.count),
    share_pct: toNumber(row.share_pct),
    sector: row.sector || "other",
    cadence: row.cadence || "",
  }));
}

export async function loadSectorIndexRows(): Promise<Array<{ date_utc: string; sector: string; sector_count: number; sector_delta_pct: number }>> {
  const rows = await readCsv("sector_indices.csv");
  return rows
    .filter((row) => row.date_utc && row.sector)
    .map((row) => ({
      date_utc: row.date_utc,
      sector: row.sector,
      sector_count: toNumber(row.sector_count),
      sector_delta_pct: toNumber(row.sector_delta_pct),
    }));
}

export async function loadGrowthRows(): Promise<Array<{
  date_utc: string;
  tld: string;
  count: number;
  delta_abs: number;
  delta_pct: number;
  cadence: string;
  status: string;
}>> {
  const rows = await readCsv("growth_trends.csv");
  return rows
    .filter((row) => row.date_utc && row.tld)
    .map((row) => ({
      date_utc: row.date_utc,
      tld: row.tld.toLowerCase(),
      count: toNumber(row.count),
      delta_abs: toNumber(row.delta_abs),
      delta_pct: toNumber(row.delta_pct),
      cadence: row.cadence || "",
      status: row.status || "",
    }));
}

export function trimSeriesByDays<T extends { date_utc: string }>(rows: T[], days: number): T[] {
  if (rows.length === 0) {
    return rows;
  }
  const sortedDates = [...new Set(rows.map((row) => row.date_utc))].sort();
  const keepDates = new Set(sortedDates.slice(-days));
  return rows.filter((row) => keepDates.has(row.date_utc));
}

export async function loadTldSeries(tld: string, days = 90) {
  const needle = tld.toLowerCase();
  const rows = await loadGrowthRows();
  const filtered = rows
    .filter((row) => row.tld === needle && row.status === "ok")
    .sort((a, b) => a.date_utc.localeCompare(b.date_utc));
  return trimSeriesByDays(filtered, days);
}

export async function loadCompareSeries(tlds: string[], days = 90) {
  const wanted = new Set(tlds.map((item) => item.toLowerCase()));
  const rows = await loadGrowthRows();
  const filtered = rows
    .filter((row) => wanted.has(row.tld) && row.status === "ok")
    .sort((a, b) => a.date_utc.localeCompare(b.date_utc));
  return trimSeriesByDays(filtered, days);
}

export async function loadDigestSnippet(lines = 30): Promise<string> {
  const digestPath = path.join(ROOTFETCH_PUBLIC, "latest.md");
  try {
    const raw = await fs.readFile(digestPath, "utf-8");
    return raw.split(/\r?\n/).slice(0, lines).join("\n").trim();
  } catch {
    return "Digest is unavailable.";
  }
}

export async function loadDigestSnippetForRun(runId: string, lines = 30): Promise<string> {
  const safeRunId = String(runId || "").trim();
  if (!safeRunId) {
    return loadDigestSnippet(lines);
  }
  const digestPath = path.join(ROOTFETCH_PUBLIC, "artifacts", "runs", safeRunId, "digest_latest.txt");
  try {
    const raw = await fs.readFile(digestPath, "utf-8");
    return raw.split(/\r?\n/).slice(0, lines).join("\n").trim();
  } catch {
    return loadDigestSnippet(lines);
  }
}

export async function loadDistributionLatest() {
  return readJson<Record<string, unknown>>("distribution_latest.json", {});
}

export async function loadConcentrationLatest() {
  return readJson<Record<string, unknown>>("concentration_latest.json", {});
}

export async function loadApprovalsDiffLatest() {
  return readJson<Record<string, unknown>>("approvals_diff_latest.json", {});
}

export async function loadSecurityStatusLatest() {
  return readJson<Record<string, unknown>>("security_status_latest.json", {});
}
