"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

type PulsePoint = {
  date_utc: string;
  total_delegated_count: number;
};

export default function PulseSeriesChart({ rows }: { rows: PulsePoint[] }) {
  if (!rows.length) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-border/60 bg-background/40 text-xs text-muted-foreground">
        No pulse series yet
      </div>
    );
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" strokeDasharray="4 4" />
          <XAxis dataKey="date_utc" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            labelFormatter={(label) => `Date ${label}`}
            contentStyle={{
              borderRadius: "10px",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
            }}
          />
          <Area
            type="monotone"
            dataKey="total_delegated_count"
            stroke="#22d3ee"
            strokeWidth={2.2}
            fill="url(#pulseFill)"
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
