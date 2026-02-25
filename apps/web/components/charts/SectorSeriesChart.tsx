"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SectorChartRow = {
  date_utc: string;
  [key: string]: string | number;
};

const PALETTE = ["#0ea5e9", "#f97316", "#10b981", "#e11d48", "#8b5cf6", "#14b8a6"];

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function SectorSeriesChart({
  rows,
  sectors,
}: {
  rows: SectorChartRow[];
  sectors: string[];
}) {
  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date_utc" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            formatter={(value: unknown, name?: string) => [fmtInt(Number(value || 0)), name ?? "value"]}
            labelFormatter={(label) => `Date: ${label}`}
            contentStyle={{
              borderRadius: "10px",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
            }}
          />
          <Legend />
          {sectors.map((sector, idx) => (
            <Line
              key={sector}
              type="monotone"
              dataKey={sector}
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={2.3}
              dot={false}
              isAnimationActive
              animationDuration={560}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
