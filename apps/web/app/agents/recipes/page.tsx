import type { Metadata } from "next";

import CopyValueButton from "@/components/CopyValueButton";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import { getAgentTaskRecipeCatalog } from "@/lib/agent-task-recipes";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";

export const metadata: Metadata = {
  title: "Agent Task Recipes",
  description: "Task-oriented RootFetch MCP recipes with strict expected output keys and evidence checks.",
  alternates: {
    canonical: "/agents/recipes",
  },
};

export default function AgentTaskRecipesPage() {
  const catalog = getAgentTaskRecipeCatalog(siteUrl);

  return (
    <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 px-4 pb-16 pt-8 md:px-8 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-all">
      <Section title="Agent Task Recipes" subtitle="Copy-paste workflows for high-confidence MCP usage.">
        <p className="text-sm text-muted-foreground">
          These recipes are outcome-first and evidence-bound. Every recipe is valid against the same
          <code> /mcp</code> endpoint.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <TrackedLink
            href="/agents"
            label="agent_recipes_back_agents"
            pageType="agent_recipes"
            className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Back to agent guide
          </TrackedLink>
          <TrackedLink
            href="/api/mcp/task-recipes"
            label="agent_recipes_open_json"
            pageType="agent_recipes"
            className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            JSON catalog
          </TrackedLink>
          <TrackedLink
            href="/agents/playground"
            label="agent_recipes_open_playground"
            pageType="agent_recipes"
            className="rounded-lg border border-border/70 px-2 py-1 hover:border-primary/50"
          >
            Playground
          </TrackedLink>
        </div>
      </Section>

      {catalog.recipes.map((recipe) => {
        const rpc = JSON.stringify(recipe.rpc_request, null, 2);
        return (
          <Section key={recipe.id} title={recipe.title} subtitle={recipe.intent}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tool: <code>{recipe.tool_name}</code>
                </p>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">RPC request</p>
                <pre className="rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">{rpc}</pre>
                <CopyValueButton
                  value={rpc}
                  keyName={`agent_recipe_rpc_${recipe.id}`}
                  context="agent_recipes_page"
                />
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">cURL</p>
                <pre className="rounded-lg border border-border/70 bg-background/70 p-4 text-xs rf-mono-digits">
                  {recipe.curl_example}
                </pre>
                <CopyValueButton
                  value={recipe.curl_example}
                  keyName={`agent_recipe_curl_${recipe.id}`}
                  context="agent_recipes_page"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Expected top-level keys</p>
                <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                  {recipe.expected_top_level.map((key) => (
                    <li key={key}>
                      <code>{key}</code>
                    </li>
                  ))}
                </ul>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Verification checklist</p>
                <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                  {recipe.verification.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        );
      })}
    </main>
  );
}
