type JsonObject = Record<string, unknown>;

export type AgentTaskRecipe = {
  id: string;
  title: string;
  intent: string;
  tool_name: string;
  arguments: JsonObject;
  expected_top_level: string[];
  verification: string[];
  rpc_request: JsonObject;
  curl_example: string;
};

export type AgentTaskRecipeCatalog = {
  generated_at_utc: string;
  schema_version: "1.0";
  endpoint: string;
  docs_url: string;
  recipes: AgentTaskRecipe[];
};

function normalizeSiteUrl(raw: string): string {
  return (raw || "https://rootfetch.com").trim().replace(/\/+$/, "");
}

function jsonString(data: unknown): string {
  return JSON.stringify(data).replace(/'/g, "'\"'\"'");
}

function buildCurlExample(siteUrl: string, body: unknown): string {
  return [
    `curl -sS ${siteUrl}/mcp \\`,
    "  -X POST \\",
    "  -H 'content-type: application/json' \\",
    "  -H 'accept: application/json, text/event-stream' \\",
    `  --data '${jsonString(body)}'`,
  ].join("\n");
}

export function getAgentTaskRecipeCatalog(siteUrlRaw: string): AgentTaskRecipeCatalog {
  const siteUrl = normalizeSiteUrl(siteUrlRaw);
  const docsUrl = `${siteUrl}/agents/recipes`;

  const baseRecipes: Array<Omit<AgentTaskRecipe, "rpc_request" | "curl_example">> = [
    {
      id: "current-structural-state",
      title: "Current Structural State",
      intent: "Get one evidence-bound structural snapshot suitable for dashboards and incident checks.",
      tool_name: "rootfetch.outcome.current_state",
      arguments: {},
      expected_top_level: [
        "outcome",
        "schema_version",
        "run_id",
        "regime",
        "concentration",
        "coverage",
        "volatility",
        "top_anomalies",
        "evidence",
      ],
      verification: [
        "evidence.run_id exists",
        "evidence.manifest_sha256 exists",
        "regime.state and regime.dvi_score exist",
      ],
    },
    {
      id: "latest-run-delta",
      title: "Latest Run Delta",
      intent: "Compare latest run vs previous run and detect structural movement with disclosure safety.",
      tool_name: "rootfetch.outcome.run_delta",
      arguments: {},
      expected_top_level: [
        "outcome",
        "schema_version",
        "left_run_id",
        "right_run_id",
        "transition",
        "concentration_delta",
        "coverage_delta",
        "temporal",
        "compare",
        "evidence",
      ],
      verification: [
        "transition.model_changed is present",
        "transition.model_transition_disclosure is honored when model_changed=true",
        "compare.compare_url exists",
      ],
    },
    {
      id: "tld-spotlight",
      title: "TLD Spotlight",
      intent: "Get a strict evidence-bound view for one namespace.",
      tool_name: "rootfetch.outcome.tld_spotlight",
      arguments: {
        tld: "app",
      },
      expected_top_level: [
        "outcome",
        "schema_version",
        "run_id",
        "tld",
        "metrics",
        "signals",
        "links",
        "evidence",
      ],
      verification: [
        "requested tld echoes in response.tld",
        "links.run_url exists",
        "evidence.manifest_sha256 exists",
      ],
    },
    {
      id: "alert-candidates",
      title: "Alert Candidates",
      intent: "Pull top anomaly/mover candidates with trigger context for alert workflows.",
      tool_name: "rootfetch.outcome.alert_candidates",
      arguments: {
        limit: 10,
      },
      expected_top_level: [
        "outcome",
        "schema_version",
        "run_id",
        "limit",
        "total_candidates",
        "triggers",
        "candidates",
        "evidence",
      ],
      verification: [
        "candidates is an array",
        "triggers include dvi_score and regime",
        "evidence.run_id matches run_id",
      ],
    },
  ];

  const recipes: AgentTaskRecipe[] = baseRecipes.map((recipe, index) => {
    const rpc_request = {
      jsonrpc: "2.0",
      id: index + 2,
      method: "tools/call",
      params: {
        name: recipe.tool_name,
        arguments: recipe.arguments,
      },
    };
    return {
      ...recipe,
      rpc_request,
      curl_example: buildCurlExample(siteUrl, rpc_request),
    };
  });

  return {
    generated_at_utc: new Date().toISOString(),
    schema_version: "1.0",
    endpoint: `${siteUrl}/mcp`,
    docs_url: docsUrl,
    recipes,
  };
}
