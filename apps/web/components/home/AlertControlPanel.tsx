"use client";

import { useMemo, useState } from "react";
import { BellRing } from "lucide-react";

import { track } from "@/lib/analytics/ga";

type AlertRow = {
  tld: string;
  delta_pct: number;
  robust_z?: number;
  sector?: string;
};

function toNum(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function severity(row: AlertRow, zThreshold: number, pctThreshold: number): "critical" | "high" | "moderate" | "info" {
  const z = Math.abs(toNum(row.robust_z));
  const pct = Math.abs(toNum(row.delta_pct));
  if (z >= Math.max(4, zThreshold + 1) || pct >= Math.max(0.06, pctThreshold * 2)) return "critical";
  if (z >= zThreshold || pct >= pctThreshold) return "high";
  if (z >= Math.max(2, zThreshold * 0.7) || pct >= Math.max(0.01, pctThreshold * 0.5)) return "moderate";
  return "info";
}

export default function AlertControlPanel({
  rows,
  dviScore,
  top10SharePct,
}: {
  rows: AlertRow[];
  dviScore: number;
  top10SharePct: number;
}) {
  const [zThreshold, setZThreshold] = useState(3.0);
  const [deltaThresholdPct, setDeltaThresholdPct] = useState(0.02);
  const [dviThreshold, setDviThreshold] = useState(50);
  const [top10Threshold, setTop10Threshold] = useState(68);
  const [destEmail, setDestEmail] = useState(false);
  const [destWebhook, setDestWebhook] = useState(true);
  const [destMcp, setDestMcp] = useState(true);
  const [showPayload, setShowPayload] = useState(false);

  const triggered = useMemo(() => {
    return rows
      .filter((row) => row && typeof row.tld === "string" && row.tld.length > 0)
      .map((row) => ({
        ...row,
        severity: severity(row, zThreshold, deltaThresholdPct),
      }))
      .filter((row) => row.severity !== "info")
      .slice(0, 24);
  }, [rows, zThreshold, deltaThresholdPct]);

  const severityCounts = useMemo(() => {
    const out = { critical: 0, high: 0, moderate: 0 };
    for (const row of triggered) {
      if (row.severity === "critical") out.critical += 1;
      else if (row.severity === "high") out.high += 1;
      else if (row.severity === "moderate") out.moderate += 1;
    }
    return out;
  }, [triggered]);

  const marketTriggers = useMemo(
    () => ({
      dvi: dviScore >= dviThreshold,
      concentration: top10SharePct >= top10Threshold,
    }),
    [dviScore, dviThreshold, top10SharePct, top10Threshold],
  );

  const payload = useMemo(
    () => ({
      mode: "local_only",
      channels: {
        email: destEmail,
        webhook: destWebhook,
        mcp_stream: destMcp,
      },
      thresholds: {
        zscore: Number(zThreshold.toFixed(2)),
        delta_pct: Number(deltaThresholdPct.toFixed(4)),
        dvi: Number(dviThreshold.toFixed(1)),
        top10_share_pct: Number(top10Threshold.toFixed(2)),
      },
      triggered_count: triggered.length + (marketTriggers.dvi ? 1 : 0) + (marketTriggers.concentration ? 1 : 0),
      triggered_preview: triggered.slice(0, 6).map((row) => ({
        tld: row.tld,
        severity: row.severity,
        z: Number(toNum(row.robust_z).toFixed(2)),
        delta_pct: Number((toNum(row.delta_pct) * 100).toFixed(2)),
        sector: row.sector || "other",
      })),
      market_flags: marketTriggers,
    }),
    [
      deltaThresholdPct,
      destEmail,
      destMcp,
      destWebhook,
      dviThreshold,
      marketTriggers,
      top10Threshold,
      triggered,
      zThreshold,
    ],
  );

  return (
    <section className="rf-glass rounded-3xl p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <BellRing className="h-3.5 w-3.5 text-primary" /> Alerting and anomaly system
          </p>
          <h2 className="font-display text-2xl font-semibold">Rule control plane</h2>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs">
          <p>Critical: {severityCounts.critical}</p>
          <p>High: {severityCounts.high}</p>
          <p>Moderate: {severityCounts.moderate}</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr,1fr]">
        <div className="space-y-3 rounded-xl border border-border/70 bg-background/35 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Trigger conditions</p>
          <label className="block text-xs">
            z-score threshold <span className="rf-mono-digits">{zThreshold.toFixed(1)}</span>
            <input
              type="range"
              min={2}
              max={5}
              step={0.1}
              value={zThreshold}
              className="mt-1 w-full accent-fuchsia-400"
              onChange={(event) => setZThreshold(toNum(event.target.value, 3))}
            />
          </label>
          <label className="block text-xs">
            daily delta threshold <span className="rf-mono-digits">{(deltaThresholdPct * 100).toFixed(2)}%</span>
            <input
              type="range"
              min={0.005}
              max={0.08}
              step={0.001}
              value={deltaThresholdPct}
              className="mt-1 w-full accent-emerald-400"
              onChange={(event) => setDeltaThresholdPct(toNum(event.target.value, 0.02))}
            />
          </label>
          <label className="block text-xs">
            DVI threshold <span className="rf-mono-digits">{dviThreshold.toFixed(1)}</span>
            <input
              type="range"
              min={20}
              max={90}
              step={1}
              value={dviThreshold}
              className="mt-1 w-full accent-amber-400"
              onChange={(event) => setDviThreshold(toNum(event.target.value, 50))}
            />
          </label>
          <label className="block text-xs">
            top10 share threshold <span className="rf-mono-digits">{top10Threshold.toFixed(1)}%</span>
            <input
              type="range"
              min={45}
              max={85}
              step={0.5}
              value={top10Threshold}
              className="mt-1 w-full accent-cyan-400"
              onChange={(event) => setTop10Threshold(toNum(event.target.value, 68))}
            />
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 bg-background/35 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Destinations</p>
          <label className="flex items-center justify-between text-sm">
            <span>Email</span>
            <input type="checkbox" checked={destEmail} onChange={() => setDestEmail((prev) => !prev)} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>Webhook</span>
            <input type="checkbox" checked={destWebhook} onChange={() => setDestWebhook((prev) => !prev)} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>MCP stream</span>
            <input type="checkbox" checked={destMcp} onChange={() => setDestMcp((prev) => !prev)} />
          </label>

          <div className="rounded-lg border border-border/70 bg-background/45 p-2 text-xs">
            <p>DVI trigger: {marketTriggers.dvi ? "ACTIVE" : "idle"}</p>
            <p>Concentration trigger: {marketTriggers.concentration ? "ACTIVE" : "idle"}</p>
            <p>Anomaly trigger rows: {triggered.length}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs"
              onClick={() => {
                setShowPayload((prev) => !prev);
                track("rf_market_filter", { filter_key: "alert_payload", value: showPayload ? "hide" : "show" });
              }}
            >
              {showPayload ? "Hide payload" : "Preview payload"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border/70 px-3 py-1.5 text-xs hover:border-primary/40"
              onClick={() => track("anomaly_open", { tld: "alert_test", sector: "control_plane" })}
            >
              Trigger test event
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Local runtime sends alerts via <code>rootfetch alerts run</code>; Vercel remains read-only.
          </p>
        </div>
      </div>

      {showPayload ? (
        <pre className="mt-3 overflow-auto rounded-xl border border-border/70 bg-black/55 p-3 font-mono text-xs text-emerald-300">
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
