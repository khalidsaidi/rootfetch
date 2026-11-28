// Hosted MCP endpoint (Vercel): https://mcp.rootfetch.com/mcp, streamable HTTP, stateless.
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../dist/tools.js";

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no server-initiated stream and no sessions to delete.
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST. Setup guide: https://rootfetch.com/mcp.html" }, id: null }));
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
