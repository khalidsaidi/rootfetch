"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { track } from "@/lib/analytics/ga";

type CurvePoint = { rank: number; tld: string; count: number };
type PowerCurvePayload = {
  today?: CurvePoint[];
  d30?: CurvePoint[];
  d90?: CurvePoint[];
  date_utc_today?: string;
  date_utc_d30?: string;
  date_utc_d90?: string;
};

type Focus = "today" | "d30" | "d90";

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function PowerCurveChart({ curve }: { curve: PowerCurvePayload }) {
  const [focus, setFocus] = useState<Focus>("today");

  const data = useMemo(() => {
    const today = curve.today || [];
    const d30 = curve.d30 || [];
    const d90 = curve.d90 || [];
    const maxRank = Math.max(today.length, d30.length, d90.length);
    const out: Array<{ rank: number; today?: number; d30?: number; d90?: number }> = [];
    for (let i = 1; i <= maxRank; i += 1) {
      out.push({
        rank: i,
        today: today[i - 1]?.count,
        d30: d30[i - 1]?.count,
        d90: d90[i - 1]?.count,
      });
    }
    return out;
  }, [curve.d30, curve.d90, curve.today]);

  if (!data.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
        Power curve data not generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ["today", curve.date_utc_today || "today"],
            ["d30", curve.date_utc_d30 || "d-30"],
            ["d90", curve.date_utc_d90 || "d-90"],
          ] as Array<[Focus, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-lg border px-2.5 py-1 ${focus === key ? "border-primary/60 bg-primary/15" : "border-border/70 bg-background/60 text-muted-foreground hover:border-primary/40"}`}
            onClick={() => {
              setFocus(key);
              track("volatility_toggle", { chart: "power_curve", range_days: key });
              track("rf_chart_range_change", { chart: "power_curve", range_days: key });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="h-[320px] w-full rounded-2xl border border-border/70 bg-background/30 p-2">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 14, right: 14, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.6)" strokeDasharray="3 3" />
            <XAxis dataKey="rank" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                borderRadius: "10px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="today" stroke="#22d3ee" dot={false} strokeWidth={focus === "today" ? 2.8 : 1.4} strokeOpacity={focus === "today" ? 1 : 0.45} />
            <Line type="monotone" dataKey="d30" stroke="#fbbf24" dot={false} strokeWidth={focus === "d30" ? 2.8 : 1.4} strokeOpacity={focus === "d30" ? 1 : 0.45} />
            <Line type="monotone" dataKey="d90" stroke="#a78bfa" dot={false} strokeWidth={focus === "d90" ? 2.8 : 1.4} strokeOpacity={focus === "d90" ? 1 : 0.45} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
