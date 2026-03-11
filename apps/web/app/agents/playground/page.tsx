import type { Metadata } from "next";

import PlaygroundClient from "./PlaygroundClient";

export const metadata: Metadata = {
  title: "Agent Playground",
  description: "Interactive MCP tool caller for RootFetch outcome and artifact tools.",
  alternates: {
    canonical: "/agents/playground",
  },
};

export default function AgentPlaygroundPage() {
  return <PlaygroundClient />;
}

