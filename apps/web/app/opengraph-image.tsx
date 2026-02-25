import { ImageResponse } from "next/og";

import { loadLatest } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

function fmt(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default async function OpengraphImage() {
  const fallbackLatest = {
    date_utc: "n/a",
    approved_tlds_count: 0,
    counted_today_count: 0,
    total_delegated_counted_today: 0,
    total_delegated_domains_today: 0,
    concentration: { top1_share_pct: 0 },
  };
  const latest = await loadLatest().catch(() => fallbackLatest);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0c1227 0%, #15365b 45%, #20527d 100%)",
          color: "#e7f2ff",
          padding: "48px",
          fontFamily: "Inter",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 24, letterSpacing: 2, textTransform: "uppercase", color: "#70d0ff" }}>RootFetch</div>
          <div style={{ fontSize: 58, fontWeight: 700, maxWidth: 680 }}>Delegation Market Structure Snapshot</div>
          <div style={{ fontSize: 24, color: "#c8def5" }}>{`Date: ${latest.date_utc}`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 360 }}>
          <div style={{ fontSize: 24 }}>{`Approved TLDs: ${fmt(latest.approved_tlds_count)}`}</div>
          <div style={{ fontSize: 24 }}>{`Snapshot total: ${fmt(latest.total_delegated_counted_today || latest.total_delegated_domains_today)}`}</div>
          <div style={{ fontSize: 24 }}>{`Observed today: ${fmt(latest.counted_today_count)}`}</div>
          <div style={{ fontSize: 24 }}>
            {`Top1 share: ${typeof latest.concentration?.top1_share_pct === "number" ? `${latest.concentration.top1_share_pct.toFixed(2)}%` : "n/a"}`}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
