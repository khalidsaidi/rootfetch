declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export type McpToolResult = {
    isError?: boolean;
    content: Array<{ type: "text"; text: string }>;
  };

  export class McpServer {
    constructor(info: { name: string; version: string });
    registerTool<TArgs extends Record<string, unknown>>(
      name: string,
      options: {
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
      },
      handler: (args: TArgs) => Promise<McpToolResult> | McpToolResult,
    ): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    constructor();
  }
}
