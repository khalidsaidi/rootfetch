import type { Metadata } from "next";

import McpLiveClient from "./McpLiveClient";

export const metadata: Metadata = {
  title: "MCP Live Activity",
  description: "Public, anonymized MCP usage and event visibility for RootFetch.",
  alternates: {
    canonical: "/mcp/live",
  },
};

export default function McpLivePage() {
  return <McpLiveClient />;
}
