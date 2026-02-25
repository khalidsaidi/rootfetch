"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default function PowerCurveChart({
  curve,
  forcedFocus,
}: {
  curve: PowerCurvePayload;
  forcedFocus?: Focus;
}) {
  const [focus, setFocus] = useState<Focus>("today");
  const effectiveFocus: Focus = forcedFocus || focus;

  const data = useMemo(() => {
    const today = curve.today || [];
    const d30 = curve.d30 || [];
    const d90 = curve.d90 || [];
    const maxRank = Math.max(today.length, d30.length, d90.length);
    const rows: Array<{ rank: number; today?: number; d30?: number; d90?: number }> = [];
    for (let i = 1; i <= maxRank; i += 1) {
      rows.push({
        rank: i,
        today: Number(today[i - 1]?.count || 0),
        d30: Number(d30[i - 1]?.count || 0),
        d90: Number(d90[i - 1]?.count || 0),
      });
    }
    return rows;
  }, [curve.d30, curve.d90, curve.today]);

  const selectedSeries = useMemo(() => {
    if (effectiveFocus === "today") return curve.today || [];
    if (effectiveFocus === "d30") return curve.d30 || [];
    return curve.d90 || [];
  }, [curve.d30, curve.d90, curve.today, effectiveFocus]);

  const top10Share = useMemo(() => {
    const total = selectedSeries.reduce((sum, row) => sum + Number(row.count || 0), 0);
    if (total <= 0) return 0;
    const top10 = selectedSeries.slice(0, 10).reduce((sum, row) => sum + Number(row.count || 0), 0);
    return top10 / total;
  }, [selectedSeries]);

  if (!data.length) {
    return (
      <div className="rf-glass rounded-2xl p-4 text-sm text-muted-foreground">
        Awaiting enough history to render concentration morph.
      </div>
    );
  }

  const key = effectiveFocus;
  const subtitle = effectiveFocus === "today" ? curve.date_utc_today || "today" : effectiveFocus === "d30" ? curve.date_utc_d30 || "d-30" : curve.date_utc_d90 || "d-90";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {forcedFocus ? (
          <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
            Replay-linked view: {effectiveFocus === "today" ? "Today" : effectiveFocus === "d30" ? "30d ago" : "90d ago"}
          </div>
        ) : (
          <div className="inline-flex overflow-hidden rounded-lg border border-border/70 text-xs">
            {(
              [
                ["today", `Today (${curve.date_utc_today || "latest"})`],
                ["d30", `30d ago (${curve.date_utc_d30 || "n/a"})`],
                ["d90", `90d ago (${curve.date_utc_d90 || "n/a"})`],
              ] as Array<[Focus, string]>
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`px-3 py-1.5 ${effectiveFocus === val ? "bg-primary/20 text-foreground" : "bg-background/60 text-muted-foreground hover:bg-muted/40"}`}
                onClick={() => {
                  setFocus(val);
                  track("volatility_toggle", { chart: "power_curve", range_days: val });
                  track("rf_chart_range_change", { chart: "power_curve", range_days: val });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">rendering profile: {subtitle}</p>
      </div>

      <div className="rf-glass h-[360px] rounded-2xl p-2">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={220}
          initialDimension={{ width: 980, height: 220 }}
        >
          <AreaChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="curveFillCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#00d4ff" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="curveFillAmber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ffb800" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ffb800" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="curveFillPurple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border) / 0.5)" strokeDasharray="3 3" />
            <XAxis dataKey="rank" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tickFormatter={(value) => fmtInt(Number(value))} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <ReferenceArea
              x1={1}
              x2={10}
              fill="rgba(0, 212, 255, 0.08)"
              label={{
                value: `Top 10 hold ${fmtPct(top10Share)}`,
                position: "insideTopLeft",
                fill: "rgba(200, 230, 255, 0.92)",
                fontSize: 11,
              }}
            />
            <Tooltip
              formatter={(value: number | string | undefined) => [fmtInt(Number(value || 0)), "delegated"]}
              labelFormatter={(label) => `rank ${label}`}
              contentStyle={{
                borderRadius: "10px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
              }}
            />
            <Area
              type="monotone"
              dataKey={key}
              stroke={effectiveFocus === "today" ? "#00d4ff" : effectiveFocus === "d30" ? "#ffb800" : "#a855f7"}
              fill={effectiveFocus === "today" ? "url(#curveFillCyan)" : effectiveFocus === "d30" ? "url(#curveFillAmber)" : "url(#curveFillPurple)"}
              strokeWidth={2.6}
              isAnimationActive
              animationDuration={520}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Concentration annotation: Top 10 hold <span className="rf-mono-digits text-foreground">{fmtPct(top10Share)}</span> in this view.
      </p>
    </div>
  );
}
