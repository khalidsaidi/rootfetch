import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadTopTldsCsv, loadTldSeries } from "@/lib/rootfetch-data";

import TldDetailClient from "./TldDetailClient";

function latestDeltaPct(rows: Array<{ delta_pct: number }>): number {
  const latest = rows.at(-1);
  return latest ? latest.delta_pct : 0;
}

export async function generateMetadata({ params }: { params: Promise<{ tld: string }> }): Promise<Metadata> {
  const { tld: raw } = await params;
  const tld = raw.toLowerCase();
  const rows = await loadTldSeries(tld, 90);
  const latest = rows.at(-1);

  return {
    title: `.${tld} Delegation Count ${latest ? latest.count.toLocaleString("en-US") : "n/a"}`,
    description: `RootFetch TLD detail for .${tld}: latest delegated count ${latest ? latest.count.toLocaleString("en-US") : "n/a"}, delta ${(latestDeltaPct(rows) * 100).toFixed(2)}%, and 90-day trend.`,
    alternates: {
      canonical: `/tld/${tld}`,
    },
    openGraph: {
      title: `.${tld} on RootFetch`,
      description: `Delegated count, trend, and cadence for .${tld}`,
      url: `/tld/${tld}`,
    },
  };
}

export default async function TldPage({ params }: { params: Promise<{ tld: string }> }) {
  const { tld: raw } = await params;
  const tld = raw.toLowerCase();

  if (!/^[a-z0-9-]+$/.test(tld)) {
    notFound();
  }

  const [rows, topRows] = await Promise.all([loadTldSeries(tld, 90), loadTopTldsCsv()]);

  const sector = topRows.find((row) => row.tld === tld)?.sector || "other";

  return <TldDetailClient tld={tld} sector={sector} initialRows={rows} />;
}
