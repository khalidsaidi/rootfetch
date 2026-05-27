export type CrossProjectSibling = {
  name: string;
  statsUrl: string;
};

export const crossProjectSiblings: readonly CrossProjectSibling[] = [
  {
    name: "A2ABench",
    statsUrl: "https://a2abench-api.web.app/stats",
  },
  {
    name: "Ragmap",
    statsUrl: "https://ragmap-api.web.app/stats",
  },
  {
    name: "Agentability",
    statsUrl: "https://agentability.org/stats",
  },
  {
    name: "RelayOrb",
    statsUrl: "https://relayorb.com/stats",
  },
  {
    name: "AIStatusDashboard",
    statsUrl: "https://aistatusdashboard.com/stats",
  },
] as const;

export const crossProjectFooterDescriptor =
  "benchmark · MCP search · agent-readiness audit · tool control plane · status monitoring";
