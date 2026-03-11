type JsonObject = Record<string, unknown>;

export type AgentTaskRecipeStep = {
  id: string;
  label: string;
  tool_name: string;
  arguments: JsonObject;
  expected_top_level: string[];
  verification: string[];
  rpc_request: JsonObject;
  curl_example: string;
  playground_url: string;
};

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
  playground_url: string;
  steps?: AgentTaskRecipeStep[];
  publish_template_fields?: string[];
};

export type AgentTaskRecipeCatalog = {
  generated_at_utc: string;
  schema_version: "1.0";
  endpoint: string;
  docs_url: string;
  recipes: AgentTaskRecipe[];
};

type RawStep = Omit<
  AgentTaskRecipeStep,
  "rpc_request" | "curl_example" | "playground_url"
>;

type RawRecipe = Omit<
  AgentTaskRecipe,
  "rpc_request" | "curl_example" | "playground_url" | "steps"
> & {
  steps?: RawStep[];
};

function normalizeSiteUrl(raw: string): string {
  return (raw || "https://rootfetch.com").trim().replace(/\/+$/, "");
}

function jsonString(data: unknown): string {
  return JSON.stringify(data).replace(/'/g, "'\"'\"'");
}

function buildRpcRequest(id: number, toolName: string, args: JsonObject): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };
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

function buildPlaygroundUrl(siteUrl: string, toolName: string, args: JsonObject): string {
  const query = new URLSearchParams({
    tool: toolName,
    args: JSON.stringify(args),
  });
  return `${siteUrl}/agents/playground?${query.toString()}`;
}

export function getAgentTaskRecipeCatalog(siteUrlRaw: string): AgentTaskRecipeCatalog {
  const siteUrl = normalizeSiteUrl(siteUrlRaw);
  const docsUrl = `${siteUrl}/agents/recipes`;

  const rawRecipes: RawRecipe[] = [
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
    {
      id: "regime-flip-bulletin-prep",
      title: "Regime Flip Bulletin Prep",
      intent: "Assemble a publish-ready payload when regime or DVI band moves materially.",
      tool_name: "rootfetch.outcome.run_delta",
      arguments: {},
      expected_top_level: [
        "outcome",
        "left_run_id",
        "right_run_id",
        "transition",
        "compare",
        "evidence",
      ],
      verification: [
        "transition.regime_changed or |transition.dvi_delta| exceeds bulletin threshold",
        "if transition.model_changed=true, include model transition disclosure",
        "evidence.left.manifest_sha256 and evidence.right.manifest_sha256 exist",
      ],
      steps: [
        {
          id: "delta",
          label: "Detect structural transition",
          tool_name: "rootfetch.outcome.run_delta",
          arguments: {},
          expected_top_level: ["transition", "compare", "evidence"],
          verification: [
            "transition object is present",
            "compare.compare_url is present",
          ],
        },
        {
          id: "state",
          label: "Load current state context",
          tool_name: "rootfetch.outcome.current_state",
          arguments: {},
          expected_top_level: ["regime", "concentration", "coverage", "evidence"],
          verification: [
            "regime.state is present",
            "concentration.hhi is present",
          ],
        },
        {
          id: "alerts",
          label: "Attach top candidate changes",
          tool_name: "rootfetch.outcome.alert_candidates",
          arguments: { limit: 15 },
          expected_top_level: ["triggers", "candidates", "evidence"],
          verification: [
            "candidates length is > 0 when anomaly rows exist",
            "triggers.regime is present",
          ],
        },
      ],
      publish_template_fields: [
        "run_pair",
        "dvi_left_right_delta",
        "regime_left_right",
        "model_transition_disclosure",
        "top_candidates_summary",
        "compare_url",
        "evidence_hashes",
      ],
    },
    {
      id: "monthly-brief-payload",
      title: "Monthly Brief Payload",
      intent: "Build a compact monthly structural brief payload from strict outcome tools.",
      tool_name: "rootfetch.outcome.current_state",
      arguments: {},
      expected_top_level: [
        "outcome",
        "run_id",
        "regime",
        "concentration",
        "coverage",
        "volatility",
        "evidence",
      ],
      verification: [
        "coverage.counted_ever_count and coverage.approved_tlds_count are present",
        "concentration.top10_share_pct and hhi are present",
        "evidence.manifest_sha256 exists",
      ],
      steps: [
        {
          id: "state",
          label: "Current month-end state",
          tool_name: "rootfetch.outcome.current_state",
          arguments: {},
          expected_top_level: ["regime", "concentration", "coverage", "volatility", "evidence"],
          verification: [
            "regime.dvi_score is present",
            "coverage metrics are present",
          ],
        },
        {
          id: "delta",
          label: "Month-over-month delta (set run pair explicitly when needed)",
          tool_name: "rootfetch.outcome.run_delta",
          arguments: {},
          expected_top_level: ["transition", "concentration_delta", "coverage_delta", "evidence"],
          verification: [
            "transition values are present",
            "coverage_delta values are present",
          ],
        },
        {
          id: "alerts",
          label: "Top changes summary for brief appendix",
          tool_name: "rootfetch.outcome.alert_candidates",
          arguments: { limit: 25 },
          expected_top_level: ["candidates", "triggers", "evidence"],
          verification: [
            "candidate rows include delta_abs or anomaly_score",
            "trigger context is present",
          ],
        },
      ],
      publish_template_fields: [
        "run_id",
        "dvi_score_band",
        "regime_state_confidence",
        "top10_share_hhi",
        "coverage_counts",
        "7d_volatility",
        "model_version",
        "evidence_hash",
      ],
    },
  ];

  let nextId = 2;
  const recipes: AgentTaskRecipe[] = rawRecipes.map((recipe) => {
    const rpcRequest = buildRpcRequest(nextId, recipe.tool_name, recipe.arguments);
    nextId += 1;

    const steps =
      recipe.steps?.map((step) => {
        const stepRpc = buildRpcRequest(nextId, step.tool_name, step.arguments);
        nextId += 1;
        return {
          ...step,
          rpc_request: stepRpc,
          curl_example: buildCurlExample(siteUrl, stepRpc),
          playground_url: buildPlaygroundUrl(siteUrl, step.tool_name, step.arguments),
        };
      }) || undefined;

    return {
      ...recipe,
      rpc_request: rpcRequest,
      curl_example: buildCurlExample(siteUrl, rpcRequest),
      playground_url: buildPlaygroundUrl(siteUrl, recipe.tool_name, recipe.arguments),
      steps,
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
