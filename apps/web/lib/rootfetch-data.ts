import { promises as fs } from "node:fs";
import path from "node:path";

export type LatestSignals = {
  date_utc: string;
  run_id: string;
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
    vercel_read_only?: boolean;
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

export type CsvRow = Record<string, string>;

const ROOTFETCH_PUBLIC = path.join(process.cwd(), "public", "rootfetch");

function toNumber(value: string | undefined): number {
  if (value === undefined || value === "") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
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
