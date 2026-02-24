import { readFile } from "node:fs/promises";
import path from "node:path";

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

type ApprovedLatest = {
  date_utc: string;
  fetched_at_utc: string;
  count: number;
  tlds: string[];
};

type CoverageLatest = {
  date_utc: string;
  approved_tlds_count: number;
  approved_tlds: string[];
  counted_today_tlds: string[];
  counted_today_count: number;
  counted_today_core_tlds?: string[];
  counted_today_core_count?: number;
  counted_today_rolling_tlds?: string[];
  counted_today_rolling_count?: number;
  counted_ever_tlds: string[];
  counted_ever_count: number;
  missing_ever_tlds: string[];
  missing_ever_count: number;
};

type RagChunk = {
  id: string;
  source_path: string;
  source_type: string;
  date_utc?: string | null;
  title?: string | null;
  text: string;
  resource_uri?: string;
};

type RagChunksFile = {
  chunks: RagChunk[];
};

const ROOTFETCH_PUBLIC_DIR = path.join(process.cwd(), "public", "rootfetch");

let ragChunksCache: RagChunk[] | null = null;

function textContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function readJsonFile<T>(filename: string): Promise<T> {
  const filePath = path.join(ROOTFETCH_PUBLIC_DIR, filename);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function loadApprovedLatest(): Promise<ApprovedLatest> {
  return readJsonFile<ApprovedLatest>("approved_latest.json");
}

async function loadCoverageLatest(): Promise<CoverageLatest> {
  return readJsonFile<CoverageLatest>("coverage_latest.json");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function excerptFor(text: string, queryTokens: string[]): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const token of queryTokens) {
    idx = lower.indexOf(token);
    if (idx >= 0) break;
  }
  if (idx < 0) {
    return text.slice(0, 240);
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 180);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function lexicalScore(query: string, queryTokens: string[], text: string): number {
  const haystack = text.toLowerCase();
  const textTokens = new Set(tokenize(haystack));
  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      overlap += 1;
    }
  }
  const phraseBoost = haystack.includes(query.toLowerCase()) ? 2 : 0;
  return overlap + phraseBoost;
}

async function loadRagChunks(): Promise<RagChunk[]> {
  if (ragChunksCache) {
    return ragChunksCache;
  }
  const payload = await readJsonFile<RagChunksFile>("rag_chunks.json");
  ragChunksCache = Array.isArray(payload?.chunks) ? payload.chunks : [];
  return ragChunksCache;
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.ROOTFETCH_MCP_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function withCorsHeaders(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  const allowedOrigins = parseAllowedOrigins();
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function ensureOriginAllowed(request: Request): Response | null {
  const allowedOrigins = parseAllowedOrigins();
  if (allowedOrigins.length === 0) {
    return null;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }
  if (!allowedOrigins.includes(origin)) {
    return withCorsHeaders(
      new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
      origin
    );
  }
  return null;
}

function ensureBearerToken(request: Request): Response | null {
  const expectedToken = process.env.ROOTFETCH_MCP_TOKEN;
  const origin = request.headers.get("origin");
  if (!expectedToken) {
    return withCorsHeaders(
      new Response(JSON.stringify({ error: "Server missing ROOTFETCH_MCP_TOKEN" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      origin
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || token !== expectedToken) {
    return withCorsHeaders(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      origin
    );
  }
  return null;
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "rootfetch_get_approved_tlds",
      {
        title: "Get Approved TLDs",
        description: "Returns the full approved TLD list from approved_latest.json",
        inputSchema: {},
      },
      async () => {
        const approved = await loadApprovedLatest();
        return textContent(approved);
      }
    );

    server.registerTool(
      "rootfetch_get_coverage",
      {
        title: "Get Coverage",
        description: "Returns approved vs counted coverage from coverage_latest.json",
        inputSchema: {},
      },
      async () => {
        const coverage = await loadCoverageLatest();
        return textContent(coverage);
      }
    );

    server.registerTool(
      "rootfetch_search_approved",
      {
        title: "Search Approved TLDs",
        description: "Substring search over approved TLDs",
        inputSchema: {
          q: z.string().min(1),
        },
      },
      async ({ q }) => {
        const approved = await loadApprovedLatest();
        const needle = q.trim().toLowerCase();
        const matches = approved.tlds.filter((tld) => tld.includes(needle));
        return textContent({
          date_utc: approved.date_utc,
          query: q,
          matches_count: matches.length,
          matches,
        });
      }
    );

    server.registerTool(
      "rootfetch_health",
      {
        title: "RootFetch Health",
        description: "Returns key coverage and freshness values",
        inputSchema: {},
      },
      async () => {
        const coverage = await loadCoverageLatest();
        return textContent({
          date_utc: coverage.date_utc,
          approved_tlds_count: coverage.approved_tlds_count,
          counted_today_count: coverage.counted_today_count,
          counted_today_core_count: coverage.counted_today_core_count ?? 0,
          counted_today_rolling_count: coverage.counted_today_rolling_count ?? 0,
          counted_ever_count: coverage.counted_ever_count,
        });
      }
    );

    server.registerTool(
      "rag_search",
      {
        title: "RAG Search",
        description: "Search precomputed RootFetch docs and digest chunks",
        inputSchema: {
          query: z.string().min(1),
          k: z.number().int().min(1).max(50).optional(),
          source_types: z.array(z.string()).optional(),
        },
      },
      async ({ query, k = 8, source_types }) => {
        const chunks = await loadRagChunks();
        const queryTokens = tokenize(query);
        const sourceFilter = Array.isArray(source_types)
          ? new Set(source_types.map((item) => item.toLowerCase()))
          : null;

        const scored = chunks
          .filter((chunk) => {
            if (!sourceFilter || sourceFilter.size === 0) {
              return true;
            }
            return sourceFilter.has((chunk.source_type || "").toLowerCase());
          })
          .map((chunk) => {
            const score = lexicalScore(query, queryTokens, chunk.text || "");
            return { chunk, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
          .slice(0, k)
          .map(({ chunk, score }) => ({
            id: chunk.id,
            score,
            source_path: chunk.source_path,
            source_type: chunk.source_type,
            date_utc: chunk.date_utc || null,
            title: chunk.title || null,
            excerpt: excerptFor(chunk.text || "", queryTokens),
            resource_uri: chunk.resource_uri || "",
          }));

        return textContent({ query, k, hits: scored });
      }
    );

    server.registerTool(
      "rag_get_chunk",
      {
        title: "Get RAG Chunk",
        description: "Return full chunk content by id",
        inputSchema: {
          id: z.string().min(1),
        },
      },
      async ({ id }) => {
        const chunks = await loadRagChunks();
        const chunk = chunks.find((item) => item.id === id);
        if (!chunk) {
          return textContent({ error: `chunk_not_found: ${id}` });
        }
        return textContent(chunk);
      }
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
  }
);

async function guardedHandler(request: Request): Promise<Response> {
  const originResult = ensureOriginAllowed(request);
  if (originResult) {
    return originResult;
  }

  const authResult = ensureBearerToken(request);
  if (authResult) {
    return authResult;
  }

  const response = await mcpHandler(request);
  return withCorsHeaders(response, request.headers.get("origin"));
}

export async function OPTIONS(request: Request): Promise<Response> {
  const originResult = ensureOriginAllowed(request);
  if (originResult) {
    return originResult;
  }
  return withCorsHeaders(new Response(null, { status: 204 }), request.headers.get("origin"));
}

export const GET = guardedHandler;
export const POST = guardedHandler;
export const DELETE = guardedHandler;
