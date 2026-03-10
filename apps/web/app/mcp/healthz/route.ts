import { GET as readyzGet, OPTIONS as readyzOptions } from "@/app/mcp/readyz/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compatibility alias used by MCP listing/hosting checkers.
export const GET = readyzGet;
export const OPTIONS = readyzOptions;
