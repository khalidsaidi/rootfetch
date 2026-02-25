"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { track } from "@/lib/analytics/ga";

type DistributionBar = {
  bucket: string;
  count: number;
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function DistributionBars({ rows }: { rows: DistributionBar[] }) {
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip formatter={(value: unknown) => [fmtInt(Number(value || 0)), "TLDs"]} contentStyle={{
            borderRadius: "10px",
            border: "1px solid hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
          }} />
          <Bar
            dataKey="count"
            fill="hsl(var(--primary))"
            radius={[8, 8, 0, 0]}
            onClick={(entry) => {
              const bucket = String((entry as { bucket?: string })?.bucket || "unknown");
              track("rf_distribution_view", { bucket });
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
