"use client";

import { useEffect, useMemo, useState } from "react";

import { track } from "@/lib/analytics/ga";

type PreviewPayload = {
  date_utc?: string;
  approved_tlds_count?: number;
  counted_today_count?: number;
  snapshot_rows_today?: number;
  total_delegated_counted_today?: number;
  top10_share_pct?: number;
  dvi_score?: number;
  market_state?: string;
};

export default function JsonArtifactPreview({ payload }: { payload: PreviewPayload }) {
  const source = useMemo(
    () =>
      JSON.stringify(
        {
          date_utc: payload.date_utc || "n/a",
          approved_tlds_count: payload.approved_tlds_count || 0,
          counted_today_count: payload.counted_today_count || 0,
          snapshot_rows_today: payload.snapshot_rows_today || 0,
          total_delegated_counted_today: payload.total_delegated_counted_today || 0,
          top10_share_pct: payload.top10_share_pct || 0,
          dvi_score: payload.dvi_score || 0,
          market_state: payload.market_state || "stable",
        },
        null,
        2,
      ),
    [payload],
  );

  const [visible, setVisible] = useState("");
  const [streamMode, setStreamMode] = useState(false);
  useEffect(() => {
    let active = true;
    let idx = 0;
    const timer = setInterval(() => {
      if (!active) return;
      idx += 8;
      setVisible(source.slice(0, idx));
      if (idx >= source.length) {
        clearInterval(timer);
      }
    }, 18);
    track("rootfetch_view", { page_type: "artifact_preview" });
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [source]);

  const streamLines = useMemo(
    () => [
      `{"event":"snapshot_loaded","date_utc":"${payload.date_utc || "n/a"}"}`,
      `{"event":"market_state","state":"${payload.market_state || "stable"}","dvi":${Number(payload.dvi_score || 0).toFixed(2)}}`,
      `{"event":"delegation_total","value":${Math.trunc(Number(payload.total_delegated_counted_today || 0))}}`,
      `{"event":"top10_share","pct":${Number(payload.top10_share_pct || 0).toFixed(2)}}`,
      `{"event":"observed_today","count":${Math.trunc(Number(payload.counted_today_count || 0))}}`,
    ],
    [payload],
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Live artifact stream</p>
        <button
          type="button"
          className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
            streamMode ? "border-primary/60 bg-primary/15 text-foreground" : "border-border/70 bg-background/45 text-muted-foreground"
          }`}
          onClick={() => setStreamMode((prev) => !prev)}
        >
          {streamMode ? "stream mode on" : "stream mode off"}
        </button>
      </div>
      <pre className="max-h-[300px] overflow-auto rounded-xl border border-border/70 bg-black/60 p-3 font-mono text-xs leading-relaxed text-emerald-300">
        {streamMode ? streamLines.map((line, idx) => <div key={idx}>{line}</div>) : visible}
        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-emerald-300/80 align-middle" />
      </pre>
    </div>
  );
}
