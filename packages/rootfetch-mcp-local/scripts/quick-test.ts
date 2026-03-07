import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "https://rootfetch.com/mcp";

function textContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const maybeContent = (payload as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(maybeContent)) return "";
  return maybeContent.find((item) => item?.type === "text")?.text ?? "";
}

async function main() {
  const client = new Client({
    name: "RootFetchQuickTest",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream",
      },
    },
  });

  console.log("Connecting to", SERVER_URL);
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("Tools:", tools.tools.map((tool) => tool.name).join(", "));

  const latestResult = await client.callTool({
    name: "rootfetch.latest",
    arguments: {},
  });
  const latestText = textContent(latestResult);
  const latest = latestText ? (JSON.parse(latestText) as { run_id?: string }) : {};
  console.log("Latest run:", latest.run_id || "(missing)");

  if (!latest.run_id) {
    throw new Error("latest_run_id_missing");
  }

  const bundleResult = await client.callTool({
    name: "rootfetch.run_bundle",
    arguments: { run_id: latest.run_id },
  });
  const bundleText = textContent(bundleResult);
  const bundle = bundleText ? (JSON.parse(bundleText) as { run_id?: string }) : {};
  console.log("Bundle run:", bundle.run_id || "(missing)");

  await client.close();
  console.log("quick-test=ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
