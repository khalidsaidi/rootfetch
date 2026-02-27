import type { Metadata } from "next";

import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = {
  title: "Security & Data Handling",
  description: "RootFetch threat model, storage boundaries, secret handling, and verification checks.",
  alternates: {
    canonical: "/security",
  },
};

export default function SecurityPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Security & Data Handling" subtitle="RootFetch is designed to publish only safe aggregates.">
        <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>No secrets are committed to git (`.env`, `.env.mcp`, tokens are local-only).</li>
          <li>No raw zone files are stored or committed (`*.zone`, `*.zone.gz`, `*.txt.gz`).</li>
          <li>Web runtime is read-only; CZDS ingestion runs locally only.</li>
          <li>Public site serves committed aggregates under `/rootfetch/*` only.</li>
          <li>`.ai/` is agent workspace and never committed.</li>
          <li>MCP endpoint enforces bearer-token and origin allowlist checks; no PII is exposed.</li>
        </ul>
      </Section>

      <Section title="Threat Model" subtitle="Short version">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Primary risks: secret leakage, accidental publication of raw zone data, and exposing mutable ingestion runtime to the public app.
          </p>
          <p>
            Mitigations: strict gitignore + staged-path checks, aggregate-only artifacts, read-only web serving path, and protected MCP endpoint.
          </p>
        </div>
      </Section>

      <Section title="How To Verify" subtitle="Run these locally from the repository root.">
        <pre className="overflow-auto rounded-lg border border-border/70 bg-background/70 p-4 font-mono text-xs leading-relaxed">
{`git ls-files | rg -n '(^\\.ai/|(^|/)\\.env($|\\.|/)|\\.zone$|\\.zone\\.gz$|\\.txt\\.gz$)' || true
python - <<'PY'
import json
print(json.load(open('data/signals/security_status_latest.json')))
PY
`}
        </pre>
      </Section>

      <TrackedLink href="/" label="back_home_security" pageType="security" className="text-sm text-primary hover:text-primary/80">
        Back to dashboard
      </TrackedLink>
    </main>
  );
}
