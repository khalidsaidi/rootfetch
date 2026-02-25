import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "About Metrics",
  description: "Metric definitions for RootFetch delegated-domain counting, movers, concentration, and cadence semantics.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="RootFetch Metrics" subtitle="How to interpret numbers across baseline and hybrid ingestion runs.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong>Primary count:</strong> <code>count_ns_sld</code> is the delegated SLD-owner count derived from NS records.
          </li>
          <li>
            <strong>Cadence:</strong> <code>baseline</code> = full bootstrap pass, <code>core</code> = high-signal daily set,
            <code>rolling</code> = deterministic long-tail refresh.
          </li>
          <li>
            <strong>Observed today:</strong> core + rolling rows fetched on the current date.
          </li>
          <li>
            <strong>Snapshot rows today:</strong> total rows available for today in committed artifacts.
          </li>
          <li>
            <strong>Concentration:</strong> top-share and HHI indicate how delegated volume clusters among largest TLDs.
          </li>
        </ul>
      </Section>

      <Section title="Safety Guarantees">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>CZDS ingestion runs locally only and never on Vercel runtime.</li>
          <li>Vercel serves read-only, committed artifacts (`/rootfetch/*`).</li>
          <li>Secrets are local (`.env`, `.env.mcp`) and gitignored.</li>
        </ul>
      </Section>

      <TrackedLink href="/" label="back_dashboard" pageType="about" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
