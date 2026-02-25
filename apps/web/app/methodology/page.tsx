import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "Methodology",
  description: "RootFetch metric definitions, cadence semantics, and interpretation guide.",
  alternates: {
    canonical: "/methodology",
  },
};

export default function MethodologyPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Methodology" subtitle="How RootFetch computes delegation intelligence.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            Primary count metric: <code>count_ns_sld</code>, delegated SLD-owner count inferred from NS records.
          </li>
          <li>
            Baseline mode: full approved-TLD sweep to establish complete coverage.
          </li>
          <li>
            Hybrid mode: core daily recounted + rolling deterministic long-tail refresh.
          </li>
          <li>
            Snapshot rows keep full visibility; observed rows track what was freshly recounted today.
          </li>
        </ul>
      </Section>

      <Section title="Conceptual Data Flow">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
{`CZDS approved list
   -> local baseline/hybrid recount
   -> daily_counts + growth_trends
   -> signals (market + trend + coverage)
   -> digest + static RAG
   -> committed artifacts
   -> read-only Vercel + MCP`}
        </pre>
      </Section>

      <Section title="Distribution" subtitle="Cross-sectional shape of delegated counts today.">
        <p id="distribution" className="text-sm text-muted-foreground">
          p50/p90/p99 summarize spread. Tiny and small buckets show long-tail breadth.
        </p>
      </Section>

      <Section title="Concentration" subtitle="How much delegated volume is held by largest TLDs.">
        <p id="concentration" className="text-sm text-muted-foreground">
          Top1/Top3/Top10 shares and HHI quantify concentration. Higher HHI indicates stronger concentration.
        </p>
      </Section>

      <Section title="Model Contract v1" subtitle="Deterministic structural model used by DVI and regime.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>DVI_v1 = weighted normalized combination of dispersion, concentration shift, and anomaly clustering.</li>
          <li>Regime_v1 uses a hysteresis state machine with minimum-duration enforcement to prevent flapping.</li>
          <li>All model fields are versioned in artifacts (`model_version`, `methodology_version`).</li>
        </ul>
      </Section>

      <Section
        title="Operational Guarantees"
        subtitle="Runtime and artifact guarantees exposed by RootFetch v1."
      >
        <ul id="operational-guarantees" className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Determinism: same snapshot inputs produce the same snapshot hash and run-scoped model outputs.</li>
          <li>Consistency: each page load anchors to one artifact run pointer (`data/artifacts/latest.json`).</li>
          <li>Immutability: `data/artifacts/runs/&lt;run_id&gt;/*` is append-only and hash-audited via `manifest.json`.</li>
          <li>Caching: run artifacts use 1-year immutable caching, while `latest` and replay index use short SWR windows.</li>
          <li>Alerts: at-least-once delivery with durable dedup, audit log, and dead-letter retention.</li>
        </ul>
      </Section>

      <TrackedLink href="/" label="back_home_methodology" pageType="methodology" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
