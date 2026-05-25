"use client";

import dynamic from "next/dynamic";

export const PulseSeriesChartClient = dynamic(() => import("@/components/charts/PulseSeriesChart"), {
  ssr: false,
  loading: () => <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">Pulse chart requires JavaScript.</div>,
});

export const MarketTreemapClient = dynamic(() => import("@/components/charts/MarketTreemap"), {
  ssr: false,
  loading: () => <div className="rf-glass rounded-2xl p-4 text-xs text-muted-foreground">Market map requires JavaScript.</div>,
});

export const PowerCurveChartClient = dynamic(() => import("@/components/charts/PowerCurveChart"), {
  ssr: false,
  loading: () => <div className="rf-glass rounded-2xl p-4 text-xs text-muted-foreground">Power curve requires JavaScript.</div>,
});

export const DelegationRadarChartClient = dynamic(() => import("@/components/charts/DelegationRadarChart"), {
  ssr: false,
  loading: () => <div className="rf-glass rounded-2xl p-4 text-xs text-muted-foreground">Radar chart requires JavaScript.</div>,
});

export const SectorIndexGridClient = dynamic(() => import("@/components/SectorIndexGrid"), {
  ssr: false,
  loading: () => <div className="rf-glass rounded-2xl p-4 text-xs text-muted-foreground">loading sector indices…</div>,
});
