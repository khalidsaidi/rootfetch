"use client";

import Link from "next/link";
import { ResponsiveContainer, LineChart, Line, Tooltip } from "recharts";

import { track } from "@/lib/analytics/ga";

type SectorIndex = {
  sector: string;
  total_delegated: number;
  delta_7d_pct?: number;
  delta_30d_pct?: number;
  volatility?: number;
  series_30d?: Array<{ date_utc: string; sector_count: number }>;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function fmtPct(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

export default function SectorIndexGrid({ rows }: { rows: SectorIndex[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
        Sector indices will appear after enough history is available.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.slice(0, 9).map((row) => (
        <Link
          key={row.sector}
          href="/sectors"
          className="rounded-2xl border border-border/70 bg-background/50 p-3 hover:border-primary/50"
          onClick={() => {
            track("sector_index_view", { sector: row.sector });
            track("rf_sector_row_click", { sector: row.sector });
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{row.sector}</p>
              <p className="mt-1 font-display text-xl font-semibold">{fmtInt(row.total_delegated)}</p>
            </div>
            <div className="text-right text-xs">
              <p className={Number(row.delta_7d_pct || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtPct(row.delta_7d_pct)} 7d</p>
              <p className={Number(row.delta_30d_pct || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtPct(row.delta_30d_pct)} 30d</p>
              <p className="text-muted-foreground">vol {typeof row.volatility === "number" ? row.volatility.toFixed(4) : "n/a"}</p>
            </div>
          </div>
          <div className="mt-2 h-[72px] w-full">
            <ResponsiveContainer>
              <LineChart data={(row.series_30d || []).slice(-30)}>
                <Line type="monotone" dataKey="sector_count" stroke="#22d3ee" dot={false} strokeWidth={1.8} />
                <Tooltip
                  formatter={(value: number | string | undefined) => [fmtInt(Number(value || 0)), "count"]}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Link>
      ))}
    </div>
  );
}
