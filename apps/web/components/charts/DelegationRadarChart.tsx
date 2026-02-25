"use client";

import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { track } from "@/lib/analytics/ga";

type RadarPoint = {
  tld: string;
  growth_pct: number;
  growth_7d_pct?: number;
  growth_30d_pct?: number;
  volatility?: number;
  anomaly_score?: number;
  count: number;
  sector?: string;
};

function bubbleColor(score: number): string {
  if (score >= 3.5) return "#a855f7";
  if (score >= 2) return "#ffb800";
  return "#00d4ff";
}

export default function DelegationRadarChart({
  rows,
  windowLabel = "now",
}: {
  rows: RadarPoint[];
  windowLabel?: string;
}) {
  if (!rows.length) {
    return (
      <div className="rf-glass rounded-2xl p-4 text-sm text-muted-foreground">
        SYSTEM STATUS
        <ul className="mt-2 space-y-1 text-xs">
          <li>• Ingestion ready</li>
          <li>• Awaiting first commit</li>
          <li>• Rolling history building</li>
          <li>• Radar requires 3 cycles</li>
        </ul>
      </div>
    );
  }

  const cleaned = rows
    .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
    .map((row) => ({
      ...row,
      volatility: Number(row.volatility || 0),
      growth_pct: Number(row.growth_pct || 0),
      anomaly_score: Number(row.anomaly_score || 0),
      z: Math.max(10, Math.min(65, Math.log10(Math.max(1, Number(row.count) || 0)) * 17)),
      fill: bubbleColor(Number(row.anomaly_score || 0)),
    }))
    .filter((row) => Number.isFinite(row.volatility) && Number.isFinite(row.growth_pct))
    .slice(0, 260);

  const maxX = Math.max(...cleaned.map((row) => Math.abs(Number(row.volatility || 0))), 0.03);
  const maxY = Math.max(...cleaned.map((row) => Math.abs(Number(row.growth_pct || 0))), 3);
  const xDomain: [number, number] = [-maxX * 1.1, maxX * 1.1];
  const yDomain: [number, number] = [-maxY * 1.15, maxY * 1.15];

  return (
    <div className="space-y-2">
      <div className="rf-glass h-[420px] rounded-2xl p-2">
        {cleaned.length > 0 ? (
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={240}
            initialDimension={{ width: 980, height: 240 }}
          >
            <ScatterChart margin={{ top: 12, right: 12, left: 6, bottom: 6 }}>
              <ReferenceArea x1={0} x2={xDomain[1]} y1={0} y2={yDomain[1]} fill="rgba(0,255,133,0.06)" />
              <ReferenceArea x1={xDomain[0]} x2={0} y1={0} y2={yDomain[1]} fill="rgba(168,85,247,0.08)" />
              <ReferenceArea x1={xDomain[0]} x2={0} y1={yDomain[0]} y2={0} fill="rgba(255,77,77,0.08)" />
              <ReferenceArea x1={0} x2={xDomain[1]} y1={yDomain[0]} y2={0} fill="rgba(0,212,255,0.08)" />
              <CartesianGrid stroke="hsl(var(--border) / 0.55)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="volatility"
                domain={xDomain}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                label={{
                  value: "30d cross-sectional volatility",
                  position: "insideBottom",
                  offset: -1,
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <YAxis
                type="number"
                dataKey="growth_pct"
                domain={yDomain}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                label={{
                  value: "normalized growth (%)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <ZAxis type="number" dataKey="z" range={[70, 430]} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1.2} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.2} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(value: number | string | undefined, key?: string) => {
                  if (key === "growth_pct") return [`${Number(value || 0).toFixed(2)}%`, "growth"];
                  if (key === "volatility") return [Number(value || 0).toFixed(4), "volatility"];
                  return [String(value), key || "value"];
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
                shape={(props: { cx?: number; cy?: number; payload?: { z?: number; fill?: string; tld?: string; sector?: string } }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null) return null;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={Math.max(3, Math.min(13, Number(payload?.z || 0) / 8))}
                      fill={payload?.fill || "#00d4ff"}
                      fillOpacity={0.78}
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth={1}
                      style={{
                        filter: `drop-shadow(0 0 10px ${payload?.fill || "#00d4ff"})`,
                        transition: "all 400ms cubic-bezier(.3,1,.4,1)",
                      }}
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
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No radar points for current replay window.</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:grid-cols-4">
        <p className="rounded border border-border/70 bg-background/40 px-2 py-1">Speculative</p>
        <p className="rounded border border-border/70 bg-background/40 px-2 py-1">Expansion</p>
        <p className="rounded border border-border/70 bg-background/40 px-2 py-1">Declining</p>
        <p className="rounded border border-border/70 bg-background/40 px-2 py-1">Mature</p>
      </div>
      <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
        <p className="rounded border border-border/60 bg-background/35 px-2 py-1">Window: {windowLabel}</p>
        <p className="rounded border border-border/60 bg-background/35 px-2 py-1">Bubble size = delegated size</p>
        <p className="rounded border border-border/60 bg-background/35 px-2 py-1">Glow = anomaly score</p>
      </div>
    </div>
  );
}
