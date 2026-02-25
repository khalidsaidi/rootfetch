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

type CompareRow = {
  date_utc: string;
  [key: string]: string | number;
};

const PALETTE = ["#0ea5e9", "#f97316", "#10b981", "#e11d48", "#8b5cf6"];

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function CompareTldChart({
  rows,
  tlds,
}: {
  rows: CompareRow[];
  tlds: string[];
}) {
  return (
    <div className="h-[330px] w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={220}
        initialDimension={{ width: 820, height: 220 }}
      >
        <LineChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
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
          {tlds.map((tld, idx) => (
            <Line
              key={tld}
              type="monotone"
              dataKey={tld}
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive
              animationDuration={550}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
