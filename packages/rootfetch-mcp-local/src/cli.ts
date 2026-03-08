#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ROOTFETCH_MCP_URL = process.env.ROOTFETCH_MCP_URL ?? "https://rootfetch.com/mcp";
const ROOTFETCH_MCP_TIMEOUT_MS = Number(process.env.ROOTFETCH_MCP_TIMEOUT_MS ?? 30000);
const MCP_VERSION = "2024-11-05";
const SERVER_VERSION = "0.1.0";

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

let requestId = 1;
let initialized = false;

function nextId(): number {
  requestId += 1;
  return requestId;
}

function parseSsePayload(raw: string): JsonRpcResponse {
  let parsed: JsonRpcResponse | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const value = JSON.parse(data) as JsonRpcResponse;
      parsed = value;
    } catch {
      // ignore non-json event frames
    }
  }
  if (!parsed) {
    throw new Error("remote_sse_parse_error");
  }
  return parsed;
}

async function remoteJsonRpc(payload: Record<string, unknown>): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROOTFETCH_MCP_TIMEOUT_MS);
  try {
    const response = await fetch(ROOTFETCH_MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`remote_http_${response.status}:${body.slice(0, 256)}`);
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      return parseSsePayload(body);
    }
    return JSON.parse(body) as JsonRpcResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  const response = await remoteJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_VERSION,
      capabilities: {},
      clientInfo: {
        name: "rootfetch-mcp-local",
        version: SERVER_VERSION,
      },
    },
  });
  if (response.error) {
    throw new Error(`initialize_failed:${response.error.message || "unknown"}`);
  }
  initialized = true;
}

async function callRemoteTool(name: string, args: Record<string, unknown> = {}) {
  await ensureInitialized();
  const response = await remoteJsonRpc({
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });
  if (response.error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: response.error.message || "remote_tool_error",
              code: response.error.code,
              data: response.error.data,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const content = response.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    return { content: content as Array<{ type: "text"; text: string }> };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response.result || {}, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "RootFetch",
  version: SERVER_VERSION,
});

server.registerTool(
  "rootfetch.latest",
  {
    title: "RootFetch Latest Pointer",
    description: "Returns latest pointer and run-scoped artifact URLs.",
    inputSchema: {},
  },
  async () => callRemoteTool("rootfetch.latest"),
);

server.registerTool(
  "rootfetch.replay_index",
  {
    title: "RootFetch Replay Index",
    description: "Returns replay index entries.",
    inputSchema: {},
  },
  async () => callRemoteTool("rootfetch.replay_index"),
);

server.registerTool(
  "rootfetch.run_manifest",
  {
    title: "RootFetch Run Manifest",
    description: "Returns manifest for a run_id (or latest when omitted).",
    inputSchema: {
      run_id: z.string().optional(),
    },
  },
  async ({ run_id }: { run_id?: string }) =>
    callRemoteTool("rootfetch.run_manifest", {
      ...(run_id ? { run_id } : {}),
    }),
);

server.registerTool(
  "rootfetch.run_bundle",
  {
    title: "RootFetch Run Bundle",
    description: "Returns model, coverage, and signals for one immutable run.",
    inputSchema: {
      run_id: z.string().optional(),
    },
  },
  async ({ run_id }: { run_id?: string }) =>
    callRemoteTool("rootfetch.run_bundle", {
      ...(run_id ? { run_id } : {}),
    }),
);

server.registerTool(
  "rootfetch.compare_link",
  {
    title: "RootFetch Compare Link",
    description: "Returns compare URL only (artifact-only, no recompute).",
    inputSchema: {
      left: z.string(),
      right: z.string(),
    },
  },
  async ({ left, right }: { left: string; right: string }) => callRemoteTool("rootfetch.compare_link", { left, right }),
);

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    // Keep help plain to avoid noisy banner output in MCP hosts.
    process.stdout.write(
      `RootFetch MCP (local stdio bridge)\n\n` +
        `Usage:\n  rootfetch-mcp\n\n` +
        `Environment:\n` +
        `  ROOTFETCH_MCP_URL        Remote MCP endpoint (default: https://rootfetch.com/mcp)\n` +
        `  ROOTFETCH_MCP_TIMEOUT_MS Request timeout in ms (default: 30000)\n`,
    );
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // stderr is safe for stdio MCP servers.
  console.error(error);
  process.exit(1);
});
