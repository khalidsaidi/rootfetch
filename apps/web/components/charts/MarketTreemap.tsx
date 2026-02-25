"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ResponsiveContainer, Treemap } from "recharts";

import { track } from "@/lib/analytics/ga";

type MarketMapRow = {
  tld: string;
  count: number;
  share_pct: number;
  delta_abs: number;
  delta_pct: number;
  delta_7d_pct?: number;
  delta_30d_pct?: number;
  anomaly_score?: number;
  sector?: string;
  cadence?: string;
};

type Mode = "today" | "d7" | "d30";
type Direction = "all" | "growth" | "contraction";

type TreeNodeDatum = {
  name: string;
  size: number;
  delta: number;
  payload: MarketMapRow;
};

type TreeNodeRenderProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  payload?: TreeNodeDatum;
  onHover?: (row: MarketMapRow) => void;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function valueForMode(row: MarketMapRow, mode: Mode): number {
  if (mode === "d7") return Number(row.delta_7d_pct || 0);
  if (mode === "d30") return Number(row.delta_30d_pct || 0);
  return Number(row.delta_pct || 0);
}

function colorForDelta(delta: number): string {
  const magnitude = Math.min(1, Math.abs(delta) / 0.08);
  const hue = delta >= 0 ? 150 : 5;
  const saturation = 62 + magnitude * 30;
  const lightness = 35 + magnitude * 20;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function glowForAnomaly(anomaly: number): number {
  if (anomaly >= 3.5) return 0.68;
  if (anomaly >= 2) return 0.4;
  return 0.18;
}

function resolveRowPayload(node: TreeNodeDatum | undefined): MarketMapRow | null {
  if (!node || typeof node !== "object") return null;
  const maybeNested = (node as unknown as { payload?: unknown }).payload;
  if (maybeNested && typeof maybeNested === "object" && "tld" in (maybeNested as object)) {
    return maybeNested as MarketMapRow;
  }
  if ("tld" in (node as object)) {
    return node as unknown as MarketMapRow;
  }
  return null;
}

function TreemapNodeContent(props: TreeNodeRenderProps) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", payload, onHover } = props;
  const row = resolveRowPayload(payload);
  if (width < 16 || height < 14 || !payload || !row) return null;
  const base = colorForDelta(Number(payload.delta || 0));
  const deltaPct = Number(payload.delta || 0) * 100;
  const anomaly = glowForAnomaly(Number(row.anomaly_score || 0));
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={base}
        fillOpacity={0.55}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
        style={{
          filter: `drop-shadow(0 0 ${8 + anomaly * 20}px rgba(168, 85, 247, ${anomaly}))`,
          transition: "all 500ms ease",
        }}
        onMouseEnter={() => onHover?.(row)}
      />
      {width > 72 && height > 20 ? (
        <text x={x + 6} y={y + 15} fill="rgba(248,252,255,0.92)" fontSize={10.5} fontWeight={600}>
          {name}
        </text>
      ) : null}
      {width > 88 && height > 34 ? (
        <text x={x + 6} y={y + 28} fill="rgba(230,240,250,0.85)" fontSize={9.5}>
          {deltaPct >= 0 ? "+" : ""}
          {deltaPct.toFixed(2)}%
        </text>
      ) : null}
    </g>
  );
}

export default function MarketTreemap({ rows }: { rows: MarketMapRow[] }) {
  const [mode, setMode] = useState<Mode>("today");
  const [sector, setSector] = useState<string>("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [activeTld, setActiveTld] = useState<string>(rows[0]?.tld || "");

  const sectors = useMemo(
    () => [
      "all",
      ...Array.from(new Set(rows.map((row) => (row?.sector || "other").toLowerCase()))).sort(),
    ],
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!row || typeof row.tld !== "string" || !row.tld) return false;
      const metric = valueForMode(row, mode);
      if (!Number.isFinite(metric)) return false;
      const rowSector = (row.sector || "other").toLowerCase();
      if (sector !== "all" && rowSector !== sector) return false;
      if (direction === "growth" && metric <= 0) return false;
      if (direction === "contraction" && metric >= 0) return false;
      return true;
    });
  }, [direction, mode, rows, sector]);

  const treeData = useMemo<TreeNodeDatum[]>(
    () =>
      filtered.slice(0, 220).map((row) => ({
        name: `.${row.tld}`,
        size: Math.max(1, Number.isFinite(Number(row.count)) ? Number(row.count) : 0),
        delta: valueForMode(row, mode),
        payload: row,
      })),
    [filtered, mode],
  );

  const top10Share = useMemo(() => {
    const total = filtered.reduce((sum, row) => sum + Number(row.count || 0), 0);
    if (total <= 0) return 0;
    const top10 = [...filtered]
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 10)
      .reduce((sum, row) => sum + Number(row.count || 0), 0);
    return top10 / total;
  }, [filtered]);

  const active = useMemo(() => {
    if (!rows.length) return null;
    if (activeTld) {
      const found = rows.find((row) => row.tld === activeTld);
      if (found) return found;
    }
    return filtered[0] || rows[0] || null;
  }, [activeTld, filtered, rows]);

  if (!rows.length) {
    return (
      <div className="rf-glass rounded-2xl p-4 text-sm text-muted-foreground">
        SYSTEM STATUS
        <ul className="mt-2 space-y-1 text-xs">
          <li>• Ingestion ready</li>
          <li>• Awaiting first commit</li>
          <li>• Rolling history building</li>
          <li>• Radar requires 3 cycles</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="inline-flex overflow-hidden rounded-lg border border-border/70">
          {(
            [
              ["today", "Today"],
              ["d7", "7d delta"],
              ["d30", "30d delta"],
            ] as Array<[Mode, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`px-3 py-1.5 ${mode === key ? "bg-primary/20 text-foreground" : "bg-background/70 text-muted-foreground hover:bg-muted/40"}`}
              onClick={() => {
                setMode(key);
                track("treemap_filter", { sort_key: key, filter_value: sector, page_type: "home" });
                track("rf_market_filter", { filter_key: "window", value: key });
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={sector}
            className="rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5 text-xs"
            onChange={(event) => {
              setSector(event.target.value);
              track("treemap_filter", { sort_key: mode, filter_value: event.target.value, page_type: "home" });
              track("rf_market_filter", { filter_key: "sector", value: event.target.value });
            }}
          >
            {sectors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={direction}
            className="rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5 text-xs"
            onChange={(event) => {
              setDirection(event.target.value as Direction);
              track("treemap_filter", { sort_key: mode, filter_value: event.target.value, page_type: "home" });
              track("rf_market_filter", { filter_key: "direction", value: event.target.value });
            }}
          >
            <option value="all">all flow</option>
            <option value="growth">growth only</option>
            <option value="contraction">contraction only</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.5fr,0.7fr]">
        <div className="rf-glass h-[480px] overflow-hidden rounded-2xl p-2">
          {treeData.length > 0 ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={220}
              initialDimension={{ width: 1200, height: 220 }}
            >
              <Treemap
                data={treeData}
                dataKey="size"
                isAnimationActive
                animationDuration={500}
                content={
                  <TreemapNodeContent
                    onHover={(row) => {
                      setActiveTld(row.tld);
                      track("treemap_filter", { page_type: "home", sort_key: mode, filter_value: row.tld });
                    }}
                  />
                }
              />
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Building structural treemap...
            </div>
          )}
        </div>

        <div className="rf-glass rounded-2xl p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Structure intelligence</p>
          {active ? (
            <>
              <p className="mt-1 font-display text-3xl font-semibold">.{active.tld}</p>
              <div className="mt-3 space-y-1.5 text-sm">
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Delegated</span>
                  <span className="rf-mono-digits">{fmtInt(active.count)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Share</span>
                  <span className="rf-mono-digits">{fmtPct(active.share_pct / 100)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">7d Δ</span>
                  <span className="rf-mono-digits">{fmtPct(Number(active.delta_7d_pct || 0))}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Volatility label</span>
                  <span>{Number(active.anomaly_score || 0) >= 3 ? "High" : Number(active.anomaly_score || 0) >= 2 ? "Moderate" : "Low"}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sector</span>
                  <span>{active.sector || "other"}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-muted-foreground">Concentration impact</span>
                  <span className="rf-mono-digits">{((active.share_pct / 100) * (active.share_pct / 100)).toFixed(4)} HHI</span>
                </p>
              </div>
              <div className="mt-3">
                <Link
                  href={`/tld/${active.tld}`}
                  className="inline-flex rounded-lg border border-border/70 px-3 py-1.5 text-xs hover:border-primary/50"
                  onClick={() => track("rf_top_tld_row_click", { tld: active.tld, rank: 0, sector: active.sector || "other" })}
                >
                  Open intelligence card
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Hover any block to inspect concentration impact.</p>
          )}

          <div className="mt-5 rounded-lg border border-border/70 bg-background/40 p-2 text-xs">
            <p className="text-muted-foreground">Top-10 concentration in current filter</p>
            <p className="rf-mono-digits mt-1 text-lg font-semibold">{fmtPct(top10Share)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
