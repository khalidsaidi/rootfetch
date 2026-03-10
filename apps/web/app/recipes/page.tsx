import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

const jsQuickstart = `npm i rootfetch-sdk-js
node -e "import('rootfetch-sdk-js').then(async ({ RootFetch }) => {
  const rf = new RootFetch({ baseUrl: '${siteUrl}' });
  const latest = await rf.latest();
  const verification = await rf.verifyManifest(latest.run_id);
  console.log({ run_id: latest.run_id, expected_count: verification.expected_count, checked_count: verification.checked_count, valid: verification.valid });
})"`;

const pyQuickstart = `pip install rootfetch-sdk-py
python3 - <<'PY'
from rootfetch_sdk import RootFetch
rf = RootFetch(base_url="${siteUrl}")
latest = rf.latest()
verification = rf.verify_manifest(latest["run_id"])
print({
  "run_id": latest["run_id"],
  "expected_count": verification["expected_count"],
  "checked_count": verification["checked_count"],
  "valid": verification["valid"],
})
PY`;

const jsVerifyCmd = "node examples/verify-run.mjs <run_id>";
const pyVerifyCmd = "python3 examples/verify_run.py <run_id>";

const verifyOutputExample = `{
  "run_id": "20260225T231501Z_83c1fd7b57c6_rootfetch_model_v1",
  "expected_count": 8,
  "checked_count": 8,
  "missing_files": [],
  "valid": true
}`;

const jsAgentCmd = `cd rootfetch-examples/agent-monitor/js
npm install
ROOTFETCH_BASE_URL=${siteUrl} npm run start:dry`;

const pyAgentCmd = `cd rootfetch-examples/agent-monitor/py
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
ROOTFETCH_BASE_URL=${siteUrl} python -m rootfetch_agent.monitor --dry-run`;

const webhookPayload = `{
  "dedup_key": "sha256:...",
  "run_id": "20260225T231501Z_83c1fd7b57c6_rootfetch_model_v1",
  "snapshot_ts_utc": "2026-02-25T23:15:01Z",
  "model_version": "rootfetch_model_v1",
  "dvi": 22.7,
  "regime": "CONSOLIDATING",
  "regime_confidence": 0.82,
  "evidence": {
    "run_url": "${siteUrl}/runs/20260225T231501Z_83c1fd7b57c6_rootfetch_model_v1",
    "compare_url": "${siteUrl}/compare?left=<prev_run_id>&right=20260225T231501Z_83c1fd7b57c6_rootfetch_model_v1"
  }
}`;

const mcpSnippet = `{
  "mcpServers": {
    "rootfetch": { "url": "${siteUrl}/mcp" }
  }
}`;

export const metadata: Metadata = {
  title: "Agent Recipes",
  description: "Copy-and-run recipes for RootFetch SDK usage, run verification, agent monitor execution, and MCP wiring.",
  alternates: {
    canonical: "/recipes",
  },
};

export default function RecipesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8 [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-all">
      <Section
        title="Agent Recipes"
        subtitle="Copy-and-run integration paths for immutable RootFetch artifacts. No secrets required."
        className="rf-glass"
      >
        <p className="text-sm text-muted-foreground">
          This page is intentionally operational: fetch artifacts, verify integrity, run monitor agents, and connect via MCP.
        </p>
      </Section>

      <Section title="1) Quickstart" subtitle="Install SDK, fetch latest pointer, verify manifest hashes.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">JavaScript</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{jsQuickstart}</pre>
            <div className="mt-2">
              <CopyValueButton value={jsQuickstart} keyName="recipes_js_quickstart" context="recipes_page" />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Python</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{pyQuickstart}</pre>
            <div className="mt-2">
              <CopyValueButton value={pyQuickstart} keyName="recipes_py_quickstart" context="recipes_page" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="2) Verify A Run" subtitle="One-liners backed by expected_count/checked_count output.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">JS verifier</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{jsVerifyCmd}</pre>
            <div className="mt-2">
              <CopyValueButton value={jsVerifyCmd} keyName="recipes_js_verify" context="recipes_page" />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Python verifier</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{pyVerifyCmd}</pre>
            <div className="mt-2">
              <CopyValueButton value={pyVerifyCmd} keyName="recipes_py_verify" context="recipes_page" />
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-border/70 bg-background/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">VerificationResult example</p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{verifyOutputExample}</pre>
        </div>
      </Section>

      <Section title="3) Agent Monitor" subtitle="Dry-run commands plus durable state behavior.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">JS monitor dry-run</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{jsAgentCmd}</pre>
            <div className="mt-2">
              <CopyValueButton value={jsAgentCmd} keyName="recipes_js_agent" context="recipes_page" />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Python monitor dry-run</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 text-xs rf-mono-digits">{pyAgentCmd}</pre>
            <div className="mt-2">
              <CopyValueButton value={pyAgentCmd} keyName="recipes_py_agent" context="recipes_page" />
            </div>
          </div>
        </div>
        <ul className="mt-4 ml-5 list-disc space-y-2 text-sm text-muted-foreground">
          <li><code>ROOTFETCH_STATE_PATH</code> defaults to <code>.rootfetch-agent-state.json</code> (durable local state).</li>
          <li><code>WEBHOOK_URL</code> is optional in dry-run; events print to stdout when omitted.</li>
          <li>Webhook sends include <code>Idempotency-Key</code> and <code>X-RootFetch-Dedup-Key</code> headers.</li>
        </ul>
      </Section>

      <Section title="4) Webhook Payload Schema" subtitle="Evidence links and model fields carried in each notification.">
        <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {webhookPayload}
        </pre>
        <div className="mt-2">
          <CopyValueButton value={webhookPayload} keyName="recipes_webhook_payload" context="recipes_page" />
        </div>
      </Section>

      <Section title="5) MCP Snippet" subtitle="Use the public, rate-limited MCP endpoint serving immutable artifact-backed tools.">
        <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
          {mcpSnippet}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyValueButton value={mcpSnippet} keyName="recipes_mcp_snippet" context="recipes_page" />
          <TrackedLink
            href="/docs/mcp"
            label="recipes_mcp_docs"
            pageType="recipes"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50"
          >
            MCP docs
          </TrackedLink>
        </div>
      </Section>

      <Section title="6) Links" subtitle="Direct pointers to contracts, examples, and run evidence routes.">
        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href="https://github.com/khalidsaidi/rootfetch/blob/main/docs/sdk_contract_v1.md"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            SDK contract <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a
            href="https://github.com/khalidsaidi/rootfetch/tree/main/rootfetch-examples/agent-monitor"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Agent monitor example <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <TrackedLink
            href="/methodology#operational-guarantees"
            label="recipes_operational_guarantees"
            pageType="recipes"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Operational guarantees
          </TrackedLink>
          <TrackedLink
            href="/methodology"
            label="recipes_methodology"
            pageType="recipes"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Methodology
          </TrackedLink>
          <TrackedLink
            href="/runs"
            label="recipes_runs_archive"
            pageType="recipes"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Runs archive
          </TrackedLink>
          <TrackedLink
            href="/compare"
            label="recipes_compare"
            pageType="recipes"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Compare runs
          </TrackedLink>
        </div>
      </Section>
    </main>
  );
}
