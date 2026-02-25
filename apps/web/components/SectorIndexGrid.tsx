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

function volatilityBand(value?: number): { label: string; tone: string } {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { label: "n/a", tone: "border-border/60 text-muted-foreground" };
  if (numeric >= 0.06) return { label: "HIGH", tone: "border-rose-400/50 text-rose-200" };
  if (numeric >= 0.03) return { label: "MODERATE", tone: "border-amber-400/50 text-amber-200" };
  return { label: "LOW", tone: "border-emerald-400/50 text-emerald-200" };
}

export default function SectorIndexGrid({ rows }: { rows: SectorIndex[] }) {
  if (!rows.length) {
    const placeholders = ["ai/tech", "commerce", "finance", "geo", "media", "other"];
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {placeholders.map((sector, idx) => (
          <div key={sector} className="rf-glass rounded-2xl border-dashed p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{sector} index</p>
            <p className="mt-2 font-display text-lg text-foreground/80">Baseline establishing</p>
            <p className="mt-1 text-xs text-muted-foreground">Cycle {Math.min(3, idx + 1)}/3</p>
            <div className="mt-3 h-2 rounded-full bg-muted/40">
              <div className="h-full rounded-full bg-gradient-to-r from-primary/70 to-cyan-300/70" style={{ width: `${Math.min(100, (idx + 1) * 30)}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.slice(0, 9).map((row) => {
        const positive = Number(row.delta_7d_pct || 0) >= 0;
        const volBand = volatilityBand(row.volatility);
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
                <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${volBand.tone}`}>
                  Volatility: {volBand.label}
                </span>
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
