"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  date_utc: string;
  count: number;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function TldSeriesChart({ rows }: { rows: Row[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date_utc" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            formatter={(value: unknown) => [fmtInt(Number(value || 0)), "Delegated count"]}
            labelFormatter={(label) => `Date: ${label}`}
            contentStyle={{
              borderRadius: "10px",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
            }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive
            animationDuration={550}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
