"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";

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
};

type Mode = "today" | "d7" | "d30";
type Direction = "all" | "growth" | "contraction";

function valueForMode(row: MarketMapRow, mode: Mode): number {
  if (mode === "d7") {
    return Number(row.delta_7d_pct || 0);
  }
  if (mode === "d30") {
    return Number(row.delta_30d_pct || 0);
  }
  return Number(row.delta_pct || 0);
}

function deltaColor(value: number): string {
  if (value > 0.03) {
    return "hsl(145 70% 44%)";
  }
  if (value > 0.005) {
    return "hsl(170 72% 45%)";
  }
  if (value < -0.03) {
    return "hsl(0 77% 58%)";
  }
  if (value < -0.005) {
    return "hsl(15 80% 56%)";
  }
  return "hsl(220 10% 45%)";
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

type TreemapNodeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  payload?: { delta?: number };
};

function TreemapNode(props: TreemapNodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", payload } = props;
  if (width < 18 || height < 16) {
    return null;
  }
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={deltaColor(Number(payload?.delta || 0))} fillOpacity={0.8} stroke="hsl(var(--background))" strokeWidth={1} />
      {width > 70 && height > 22 ? (
        <text x={x + 6} y={y + 15} fill="white" fontSize={11} fontWeight={600}>
          {name}
        </text>
      ) : null}
    </g>
  );
}

export default function MarketTreemap({ rows }: { rows: MarketMapRow[] }) {
  const [mode, setMode] = useState<Mode>("today");
  const [sector, setSector] = useState<string>("all");
  const [direction, setDirection] = useState<Direction>("all");

  const sectors = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((row) => (row.sector || "other").toLowerCase()))).sort()],
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const rowSector = (row.sector || "other").toLowerCase();
      const metric = valueForMode(row, mode);
      if (sector !== "all" && rowSector !== sector) {
        return false;
      }
      if (direction === "growth" && metric <= 0) {
        return false;
      }
      if (direction === "contraction" && metric >= 0) {
        return false;
      }
      return true;
    });
  }, [direction, mode, rows, sector]);

  const data = useMemo(
    () =>
      filtered.slice(0, 180).map((row) => ({
        name: `.${row.tld}`,
        size: Math.max(1, row.count),
        delta: valueForMode(row, mode),
        payload: row,
      })),
    [filtered, mode],
  );

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
        Market map data not generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex overflow-hidden rounded-lg border border-border/70">
          {(
            [
              ["today", "Today"],
              ["d7", "7d"],
              ["d30", "30d"],
            ] as Array<[Mode, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`px-2.5 py-1 ${mode === key ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
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
        <select
          value={sector}
          className="rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-xs"
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
          className="rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-xs"
          onChange={(event) => {
            setDirection(event.target.value as Direction);
            track("treemap_filter", { sort_key: mode, filter_value: event.target.value, page_type: "home" });
            track("rf_market_filter", { filter_key: "direction", value: event.target.value });
          }}
        >
          <option value="all">all</option>
          <option value="growth">growth only</option>
          <option value="contraction">contraction only</option>
        </select>
      </div>

      <div className="h-[360px] w-full rounded-2xl border border-border/70 bg-background/30 p-2">
        <ResponsiveContainer>
          <Treemap data={data} dataKey="size" stroke="hsl(var(--background))" content={<TreemapNode />} isAnimationActive animationDuration={600}>
            <Tooltip
              formatter={(value: unknown, key?: string, item?: { payload?: { payload?: MarketMapRow } }) => {
                if (key === "size") {
                  return [fmtInt(Number(value || 0)), "delegated"];
                }
                const source = (item?.payload?.payload || item?.payload) as MarketMapRow | undefined;
                if (!source) {
                  return [String(value), "value"];
                }
                return [fmtPct(valueForMode(source, mode)), mode === "today" ? "delta today" : mode === "d7" ? "delta 7d" : "delta 30d"];
              }}
              labelFormatter={(_, payload) => {
                const entry = payload?.[0] as { payload?: { payload?: MarketMapRow } } | undefined;
                const source = entry?.payload?.payload;
                return source ? `.${source.tld} (${source.sector || "other"})` : "tld";
              }}
              contentStyle={{
                borderRadius: "10px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.slice(0, 9).map((row, idx) => (
          <Link
            key={`${row.tld}-${idx}`}
            href={`/tld/${row.tld}`}
            className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm hover:border-primary/40"
            onClick={() => {
              track("rf_top_tld_row_click", { tld: row.tld, rank: idx + 1, sector: row.sector || "other" });
              track("anomaly_open", { tld: row.tld, sector: row.sector || "other" });
            }}
          >
            <p className="font-medium">.{row.tld}</p>
            <p className="text-xs text-muted-foreground">
              {fmtInt(row.count)} • {fmtPct(valueForMode(row, mode))}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
