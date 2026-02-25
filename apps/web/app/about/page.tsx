import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "About RootFetch",
  description: "What RootFetch is, why it exists, and how local-only ingestion powers read-only public intelligence.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="About RootFetch" subtitle="Delegation intelligence built from DNS-visible evidence.">
        <p className="text-sm leading-relaxed text-muted-foreground">
          RootFetch tracks CZDS-approved TLD delegation activity from local ingestion runs. It does not ingest on Vercel, does not publish
          raw zones, and does not rely on marketing dashboards.
        </p>
      </Section>

      <Section title="What Makes It Different">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Baseline + hybrid cadence balances complete coverage and daily freshness.</li>
          <li>Cross-sectional market structure (top shares, distribution, HHI) gives immediate context.</li>
          <li>Trend signals (core movers, rolling updates, sector indices) show change without cloud ingestion.</li>
          <li>Static RAG + MCP make the dataset AI-native for tools and agents.</li>
        </ul>
      </Section>

      <Section title="Safety Guarantees">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>CZDS ingestion runs locally only and never on Vercel runtime.</li>
          <li>Vercel serves read-only, committed artifacts (`/rootfetch/*`).</li>
          <li>Secrets are local (`.env`, `.env.mcp`) and gitignored.</li>
        </ul>
      </Section>

      <div className="flex flex-wrap gap-3 text-sm">
        <TrackedLink href="/methodology" label="open_methodology_about" pageType="about" className="text-primary hover:text-primary/80">
          Methodology
        </TrackedLink>
        <TrackedLink href="/security" label="open_security_about" pageType="about" className="text-primary hover:text-primary/80">
          Security
        </TrackedLink>
      </div>

      <TrackedLink href="/" label="back_dashboard" pageType="about" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
