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

  return (
    <pre className="max-h-[300px] overflow-auto rounded-xl border border-border/70 bg-black/60 p-3 font-mono text-xs leading-relaxed text-emerald-300">
      {visible}
      <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-emerald-300/80 align-middle" />
    </pre>
  );
}
