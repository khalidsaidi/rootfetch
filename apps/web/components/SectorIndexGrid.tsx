"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

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
      <div className="rf-glass rounded-2xl p-4 text-sm text-muted-foreground">
        Sector indices are building. First three cycles establish volatility baselines.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.slice(0, 9).map((row) => {
        const positive = Number(row.delta_7d_pct || 0) >= 0;
        return (
          <Link
            key={row.sector}
            href="/sectors"
            className="rf-glass rounded-2xl p-3 hover:border-primary/50"
            onClick={() => {
              track("sector_index_view", { sector: row.sector });
              track("rf_sector_row_click", { sector: row.sector });
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{row.sector} index</p>
                <p className="rf-mono-digits mt-1 text-2xl font-semibold">{fmtInt(row.total_delegated)}</p>
              </div>
              <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${positive ? "border-emerald-400/40 text-emerald-300" : "border-rose-400/40 text-rose-300"}`}>
                {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {fmtPct(row.delta_7d_pct)}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <p>7d <span className="rf-mono-digits">{fmtPct(row.delta_7d_pct)}</span></p>
              <p>30d <span className="rf-mono-digits">{fmtPct(row.delta_30d_pct)}</span></p>
              <p>vol <span className="rf-mono-digits">{typeof row.volatility === "number" ? row.volatility.toFixed(4) : "n/a"}</span></p>
            </div>
            <div className="mt-2 h-[78px] w-full rounded-lg border border-border/60 bg-background/35 px-1">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={48}
                initialDimension={{ width: 300, height: 48 }}
              >
                <LineChart data={(row.series_30d || []).slice(-30)}>
                  <Line type="monotone" dataKey="sector_count" stroke={positive ? "#00ff85" : "#ff4d4d"} dot={false} strokeWidth={2} />
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
        );
      })}
    </div>
  );
}
