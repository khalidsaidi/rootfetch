import type { Metadata } from "next";
import Link from "next/link";

import { loadRootfetchPublicStats } from "@/lib/public-stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public Stats",
  description: "Server-rendered public RootFetch counters for MCP usage and run freshness.",
  alternates: {
    canonical: "/stats",
  },
};

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default async function StatsPage() {
  const stats = await loadRootfetchPublicStats();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 md:px-8">
      <section className="rf-glass rounded-3xl p-5 md:p-7">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">RootFetch</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Public stats</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Server-rendered snapshot at {stats.generated_at}. JSON:{" "}
          <Link href="/stats.json" className="text-primary hover:underline">
            /stats.json
          </Link>
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Unique callers (7d / 30d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">
              {fmtInt(stats.unique_callers_7d)} / {fmtInt(stats.unique_callers_30d)}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">MCP calls (7d / 30d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">
              {fmtInt(stats.mcp_calls_7d)} / {fmtInt(stats.mcp_calls_30d)}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Tool-call success (7d)</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{stats.tool_call_success_pct.toFixed(2)}%</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Last successful run</p>
            <p className="mt-1 rf-mono-digits text-sm font-semibold">
              {stats.last_run_ts || "n/a"}
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Snapshot freshness</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">{stats.snapshot_freshness_label}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <p className="text-xs text-muted-foreground">Observed / tracked TLDs</p>
            <p className="mt-1 rf-mono-digits text-xl font-semibold">
              {fmtInt(stats.observed_tlds_ever)} / {fmtInt(stats.tracked_tlds)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          <Link href="/" className="text-primary hover:text-primary/80">
            Back to homepage
          </Link>{" "}
          ·{" "}
          Cross-project stats:{" "}
          <a href="https://a2abench-api.web.app/stats" className="text-primary hover:text-primary/80">
            A2ABench
          </a>{" "}
          ·{" "}
          <a href="https://ragmap-api.web.app/stats" className="text-primary hover:text-primary/80">
            Ragmap
          </a>
        </p>
      </section>
    </main>
  );
}
