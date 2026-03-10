import { expect, test } from "@playwright/test";

const protectedAdminPaths = [
  "/admin/usage",
  "/admin/agent-events",
  "/admin/alerts",
  "/api/mcp/stats?days=7",
  "/api/mcp/events?limit=20",
];

test("public docs and ops pages render without uncaught browser errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/ops", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Operations Scoreboard" })).toBeVisible();

  await page.goto("/docs/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Integration Runbooks" })).toBeVisible();

  await page.goto("/docs/mcp", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "RootFetch MCP Docs" })).toBeVisible();

  await page.goto("/mcp/live", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "MCP Live Activity" })).toBeVisible();

  await page.goto("/for-teams", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "RootFetch For Teams" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("MCP initialize and tools/list JSON-RPC calls succeed", async ({ request }) => {
  const init = await request.post("/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: "init-live-1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "e2e-live", version: "1.0.0" },
        capabilities: {},
      },
    },
  });

  expect(init.status()).toBe(200);
  const initBody = await init.text();
  expect(initBody).toContain("protocolVersion");
  expect(initBody).toContain("rootfetch-mcp");

  const tools = await request.post("/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: "tools-live-1",
      method: "tools/list",
      params: {},
    },
  });

  expect(tools.status()).toBe(200);
  const toolsBody = await tools.text();
  expect(toolsBody).toContain("rootfetch.latest");
  expect(toolsBody).toContain("rootfetch.compare_link");
});

test("legacy /api/mcp endpoint still serves tools/list and tools/call", async ({ request }) => {
  const tools = await request.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: "api-tools-live-1",
      method: "tools/list",
      params: {},
    },
  });

  expect(tools.status()).toBe(200);
  const toolsBody = await tools.text();
  expect(toolsBody).toContain("rootfetch.latest");
  expect(toolsBody).toContain("rootfetch.compare_link");

  const call = await request.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: "api-call-live-1",
      method: "tools/call",
      params: {
        name: "rootfetch.latest",
        arguments: {},
      },
    },
  });

  expect(call.status()).toBe(200);
  const callBody = await call.text();
  expect(callBody).toContain("run_id");
});

test("well-known discovery artifacts resolve", async ({ request }) => {
  for (const path of [
    "/air.json",
    "/.well-known/air.json",
    "/.well-known/glama.json",
    "/openapi.json",
    "/.well-known/openapi.json",
    "/ai-plugin.json",
    "/.well-known/ai-plugin.json",
    "/llms.txt",
    "/llms-full.txt",
    "/docs/hosting/mcp/",
    "/docs/hosting/mcp/health.json",
    "/docs/hosting/mcp/healthz.json",
    "/mcp/healthz",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
  }
});

test("public MCP telemetry endpoints resolve without auth", async ({ request }) => {
  for (const path of [
    "/api/mcp/public-stats?days=7",
    "/api/mcp/public-events?limit=20",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
  }
});

test("admin telemetry surfaces stay access-controlled", async ({ request }) => {
  for (const path of protectedAdminPaths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
});

test("ops scoreboard API returns healthy JSON", async ({ request }) => {
  const response = await request.get("/api/ops/scoreboard");
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toHaveProperty("run_reliability");
  expect(body).toHaveProperty("publication_cadence");
  expect(body).toHaveProperty("adoption");
  expect(body).toHaveProperty("targets_90d");
});
