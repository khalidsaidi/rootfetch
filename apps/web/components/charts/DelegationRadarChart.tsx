"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import { track } from "@/lib/analytics/ga";

type RadarPoint = {
  tld: string;
  growth_pct: number;
  volatility?: number;
  anomaly_score?: number;
  count: number;
  sector?: string;
};

function pointColor(score?: number): string {
  const value = Number(score || 0);
  if (value >= 3.5) return "#d946ef";
  if (value >= 2) return "#f59e0b";
  return "#22d3ee";
}

export default function DelegationRadarChart({ rows }: { rows: RadarPoint[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
        Radar points are not available yet.
      </div>
    );
  }

  const cleaned = rows
    .map((row) => ({
      ...row,
      volatility: Number(row.volatility || 0),
      growth_pct: Number(row.growth_pct || 0),
      anomaly_score: Number(row.anomaly_score || 0),
      z: Math.max(10, Math.min(60, Math.log10(Math.max(1, row.count)) * 16)),
      fill: pointColor(row.anomaly_score),
    }))
    .slice(0, 240);

  return (
    <div className="h-[340px] w-full rounded-2xl border border-border/70 bg-background/30 p-2">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="volatility" name="volatility" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis type="number" dataKey="growth_pct" name="growth_pct" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <ZAxis type="number" dataKey="z" range={[60, 420]} />
          <ReferenceLine x={0} stroke="hsl(var(--border))" strokeDasharray="6 6" />
          <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="6 6" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value: unknown, key?: string) => {
              if (key === "growth_pct") {
                return [`${Number(value || 0).toFixed(2)}%`, "growth"];
              }
              if (key === "volatility") {
                return [Number(value || 0).toFixed(4), "volatility"];
              }
              return [String(value), key];
            }}
            labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as RadarPoint | undefined;
              return row ? `.${row.tld} (${row.sector || "other"})` : "tld";
            }}
            contentStyle={{
              borderRadius: "10px",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
            }}
          />
          <Scatter
            data={cleaned}
            fill="#22d3ee"
            shape={(props: { cx?: number; cy?: number; payload?: { z?: number; fill?: string; tld?: string; sector?: string } }) => {
              const { cx, cy, payload } = props;
              if (!cx || !cy) return null;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(3, Math.min(13, Number(payload?.z || 0) / 8))}
                  fill={payload?.fill || "#22d3ee"}
                  fillOpacity={0.8}
                  stroke="hsl(var(--background))"
                  strokeWidth={1}
                  onClick={() => {
                    track("anomaly_open", { tld: payload?.tld || "", sector: payload?.sector || "other" });
                    track("rf_rolling_update_click", { tld: payload?.tld || "" });
                  }}
                />
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
        <p>High growth / high vol: speculative</p>
        <p>High growth / low vol: stable expansion</p>
        <p>Low growth / high vol: manipulation risk</p>
        <p>Low growth / low vol: mature</p>
      </div>
    </div>
  );
}
