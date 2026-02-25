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
      <div className="rf-glass flex h-[180px] flex-col items-center justify-center rounded-xl text-xs text-muted-foreground">
        <p>Awaiting first committed snapshot…</p>
        <div className="mt-3 flex w-44 items-end gap-1">
          {[10, 18, 9, 22, 14, 19, 8, 17, 11, 20, 13, 16].map((height, idx) => (
            <span
              key={idx}
              className="w-2 rounded-sm bg-primary/50"
              style={{
                height: `${height}px`,
                animation: `pulse ${0.9 + idx * 0.04}s ease-in-out ${idx * 0.05}s infinite alternate`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={120}
        initialDimension={{ width: 720, height: 120 }}
      >
        <AreaChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.42} />
              <stop offset="95%" stopColor="#00d4ff" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.5)" strokeDasharray="4 4" />
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
            stroke="#00d4ff"
            strokeWidth={2.6}
            fill="url(#pulseFill)"
            isAnimationActive
            animationDuration={700}
            style={{ filter: "drop-shadow(0 0 12px rgba(0,212,255,0.35))" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
