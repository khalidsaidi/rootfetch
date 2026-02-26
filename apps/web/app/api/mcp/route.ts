import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import {
  loadArtifactLatestPointer,
  loadReplayIndex,
  loadRunBundleById,
  loadRunCompareBundleById,
  type ArtifactLatestPointer,
  type ReplayIndexArtifact,
  type RunScopedBundle,
} from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.ROOTFETCH_MCP_RATE_LIMIT_PER_MINUTE || 60));
const RATE_LIMIT_BURST = Math.max(1, Number(process.env.ROOTFETCH_MCP_RATE_BURST || 20));
const RATE_LIMIT_REFILL_PER_SEC = RATE_LIMIT_PER_MINUTE / 60;
const RATE_LIMIT_STATE_TTL_SECONDS = Math.max(120, Math.ceil((RATE_LIMIT_BURST / RATE_LIMIT_REFILL_PER_SEC) * 2));
const MAX_TOOL_PAYLOAD_BYTES = Math.max(256_000, Number(process.env.ROOTFETCH_MCP_MAX_PAYLOAD_BYTES || 5_000_000));

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  mode: "shared" | "local";
  statusCode?: number;
  reason?: string;
};

type LocalBucketState = {
  tokens: number;
  ts: number;
  lastSeen: number;
};

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])

if tokens == nil then tokens = capacity end
if ts == nil then ts = now end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end

tokens = math.min(capacity, tokens + (elapsed * refill))
local allowed = 0
local retry_after = 0

if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
else
  retry_after = math.ceil((1 - tokens) / refill)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)

return {allowed, tokens, retry_after}
`;

const RATE_LIMIT_MODE = String(process.env.ROOTFETCH_MCP_RATE_LIMIT_MODE || "auto").toLowerCase();
const LOCAL_BUCKET_MAX_KEYS = Math.max(500, Number(process.env.ROOTFETCH_MCP_LOCAL_BUCKET_MAX_KEYS || 5000));
const localBuckets = new Map<string, LocalBucketState>();

function textContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function responseWithHeaders(response: Response, extraHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  for (const [key, value] of extraHeaders.entries()) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonWithHeaders(payload: unknown, status: number, headers: Headers): Response {
  return responseWithHeaders(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    headers,
  );
}

function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

async function upstashCommand(command: Array<string | number>): Promise<unknown> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("upstash_not_configured");
  }

  const response = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`upstash_http_${response.status}`);
  }

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(`upstash_error:${payload.error}`);
  }
  return payload.result;
}

function applyTokenBucket(tokens: number, ts: number, nowSec: number): { allowed: boolean; tokens: number; retryAfterSeconds: number } {
  const elapsed = Math.max(0, nowSec - ts);
  const refilled = Math.min(RATE_LIMIT_BURST, tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC);
  if (refilled >= 1) {
    return {
      allowed: true,
      tokens: refilled - 1,
      retryAfterSeconds: 0,
    };
  }
  return {
    allowed: false,
    tokens: refilled,
    retryAfterSeconds: Math.max(1, Math.ceil((1 - refilled) / RATE_LIMIT_REFILL_PER_SEC)),
  };
}

function trimLocalBuckets(): void {
  if (localBuckets.size <= LOCAL_BUCKET_MAX_KEYS) {
    return;
  }
  const entries = Array.from(localBuckets.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const removeCount = localBuckets.size - LOCAL_BUCKET_MAX_KEYS;
  for (let idx = 0; idx < removeCount; idx += 1) {
    const key = entries[idx]?.[0];
    if (key) {
      localBuckets.delete(key);
    }
  }
}

function enforceLocalRateLimit(request: Request): RateLimitDecision {
  const ip = extractClientIp(request);
  const nowSec = Date.now() / 1000;
  const state = localBuckets.get(ip) || { tokens: RATE_LIMIT_BURST, ts: nowSec, lastSeen: nowSec };
  const next = applyTokenBucket(state.tokens, state.ts, nowSec);
  localBuckets.set(ip, { tokens: next.tokens, ts: nowSec, lastSeen: nowSec });
  trimLocalBuckets();
  return {
    allowed: next.allowed,
    limit: RATE_LIMIT_PER_MINUTE,
    remaining: Math.max(0, Math.floor(next.tokens)),
    retryAfterSeconds: next.retryAfterSeconds,
    mode: "local",
  };
}

async function enforceRateLimit(request: Request): Promise<RateLimitDecision> {
  const hasSharedBackend = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
  const requireShared = RATE_LIMIT_MODE === "shared";
  const forceLocal = RATE_LIMIT_MODE === "local";

  if (!forceLocal && hasSharedBackend) {
    try {
      const ip = extractClientIp(request);
      const key = `rootfetch:mcp:bucket:${ip}`;
      const nowSec = Date.now() / 1000;

      const result = await upstashCommand([
        "EVAL",
        TOKEN_BUCKET_LUA,
        "1",
        key,
        String(nowSec),
        String(RATE_LIMIT_BURST),
        String(RATE_LIMIT_REFILL_PER_SEC),
        String(RATE_LIMIT_STATE_TTL_SECONDS),
      ]);

      const [allowedRaw, tokensRaw, retryAfterRaw] = Array.isArray(result) ? result : [0, 0, 1];
      const allowed = Number(allowedRaw) === 1;
      const remaining = Math.max(0, Math.floor(Number(tokensRaw) || 0));
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(retryAfterRaw) || 1));

      return {
        allowed,
        limit: RATE_LIMIT_PER_MINUTE,
        remaining,
        retryAfterSeconds: allowed ? 0 : retryAfterSeconds,
        mode: "shared",
      };
    } catch (error) {
      if (requireShared) {
        return {
          allowed: false,
          limit: RATE_LIMIT_PER_MINUTE,
          remaining: 0,
          retryAfterSeconds: 60,
          statusCode: 503,
          reason: `rate_limit_backend_error:${error instanceof Error ? error.message : "unknown"}`,
          mode: "shared",
        };
      }
      return enforceLocalRateLimit(request);
    }
  }

  if (requireShared && !hasSharedBackend) {
    return {
      allowed: false,
      limit: RATE_LIMIT_PER_MINUTE,
      remaining: 0,
      retryAfterSeconds: 60,
      statusCode: 503,
      reason: "rate_limit_backend_not_configured",
      mode: "shared",
    };
  }
  return enforceLocalRateLimit(request);
}

function buildRateHeaders(decision: RateLimitDecision): Headers {
  const headers = new Headers();
  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(Math.max(0, decision.remaining)));
  headers.set("X-RateLimit-Mode", decision.mode);
  if (!decision.allowed && decision.retryAfterSeconds > 0) {
    headers.set("Retry-After", String(decision.retryAfterSeconds));
  }
  return headers;
}

function assertRunId(runId: string): string {
  const trimmed = String(runId || "").trim();
  if (!trimmed || !RUN_ID_PATTERN.test(trimmed)) {
    throw new Error("invalid_run_id");
  }
  return trimmed;
}

function bytesLengthOf(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload));
}

function artifactUrlsForRun(runId: string): Record<string, string> {
  const enc = encodeURIComponent(runId);
  const base = `/rootfetch/artifacts/runs/${enc}`;
  return {
    manifest: `${base}/manifest.json`,
    model: `${base}/model_latest.json`,
    coverage: `${base}/coverage_latest.json`,
    signals: `${base}/signals_latest.json`,
    treemap: `${base}/treemap_latest.json`,
    radar: `${base}/radar_latest.json`,
    digest: `${base}/digest_latest.txt`,
  };
}

function ensurePayloadWithinLimit(toolName: string, payload: unknown): unknown {
  const bytes = bytesLengthOf(payload);
  if (bytes <= MAX_TOOL_PAYLOAD_BYTES) {
    return payload;
  }
  return {
    error: "payload_too_large",
    tool: toolName,
    bytes,
    max_bytes: MAX_TOOL_PAYLOAD_BYTES,
  };
}

async function resolveRunId(explicitRunId?: string): Promise<string> {
  if (explicitRunId) {
    return assertRunId(explicitRunId);
  }
  const pointer = await loadArtifactLatestPointer();
  const runId = String(pointer?.run_id || "").trim();
  if (!runId) {
    throw new Error("latest_run_unavailable");
  }
  return assertRunId(runId);
}

function shapeLatest(pointer: ArtifactLatestPointer | null): Record<string, unknown> {
  if (!pointer || !pointer.run_id) {
    return {
      error: "latest_not_found",
      latest_url: "/rootfetch/artifacts/latest.json",
    };
  }
  return {
    ...pointer,
    latest_url: "/rootfetch/artifacts/latest.json",
    run_url: `/runs/${encodeURIComponent(pointer.run_id)}`,
    artifact_urls: artifactUrlsForRun(pointer.run_id),
  };
}

function shapeReplay(replay: ReplayIndexArtifact): Record<string, unknown> {
  const runs = Array.isArray(replay.runs) ? replay.runs : [];
  return {
    replay_index_url: "/rootfetch/artifacts/replay/index.json",
    count: runs.length,
    runs,
  };
}

function shapeRunManifest(runId: string, bundle: RunScopedBundle): Record<string, unknown> {
  return {
    run_id: runId,
    run_url: `/runs/${encodeURIComponent(runId)}`,
    manifest_url: `${bundle.baseHref}/manifest.json`,
    manifest: bundle.manifest,
    manifest_sha256: bundle.manifestSha256,
    expected_count: bundle.expectedCount,
    checked_count: bundle.checkedCount,
    missing_files: bundle.missingPaths,
    artifact_urls: artifactUrlsForRun(runId),
  };
}

function shapeRunBundle(runId: string, bundle: RunScopedBundle): Record<string, unknown> {
  return {
    run_id: runId,
    run_url: `/runs/${encodeURIComponent(runId)}`,
    compare_to_latest_url: `/compare?left=${encodeURIComponent(runId)}&right=latest`,
    artifact_urls: artifactUrlsForRun(runId),
    manifest: {
      ...bundle.manifest,
      manifest_sha256: bundle.manifestSha256,
      expected_count: bundle.expectedCount,
      checked_count: bundle.checkedCount,
      missing_files: bundle.missingPaths,
    },
    model: bundle.model,
    coverage: bundle.coverage,
    signals: bundle.signals,
    digest: bundle.digest,
  };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "rootfetch.latest",
      {
        title: "RootFetch Latest Pointer",
        description: "Returns /rootfetch/artifacts/latest.json and run-scoped artifact URLs.",
        inputSchema: {},
      },
      async () => {
        const pointer = await loadArtifactLatestPointer();
        const payload = ensurePayloadWithinLimit("rootfetch.latest", shapeLatest(pointer));
        return textContent(payload);
      },
    );

    server.registerTool(
      "rootfetch.replay_index",
      {
        title: "RootFetch Replay Index",
        description: "Returns /rootfetch/artifacts/replay/index.json entries.",
        inputSchema: {},
      },
      async () => {
        const replay = await loadReplayIndex();
        const payload = ensurePayloadWithinLimit("rootfetch.replay_index", shapeReplay(replay));
        return textContent(payload);
      },
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
      async ({ run_id }) => {
        const runId = await resolveRunId(run_id);
        const bundle = await loadRunBundleById(runId);
        if (!bundle) {
          return textContent({ error: "run_not_found", run_id: runId });
        }
        const payload = ensurePayloadWithinLimit("rootfetch.run_manifest", shapeRunManifest(runId, bundle));
        return textContent(payload);
      },
    );

    server.registerTool(
      "rootfetch.run_bundle",
      {
        title: "RootFetch Run Bundle",
        description: "Returns model_latest.json + coverage_latest.json + signals_latest.json for one immutable run.",
        inputSchema: {
          run_id: z.string().optional(),
        },
      },
      async ({ run_id }) => {
        const runId = await resolveRunId(run_id);
        const bundle = await loadRunBundleById(runId);
        if (!bundle) {
          return textContent({ error: "run_not_found", run_id: runId });
        }
        const payload = ensurePayloadWithinLimit("rootfetch.run_bundle", shapeRunBundle(runId, bundle));
        return textContent(payload);
      },
    );

    server.registerTool(
      "rootfetch.compare_link",
      {
        title: "RootFetch Compare Link",
        description: "Returns compare URL only (artifact-only; no server-side recompute).",
        inputSchema: {
          left: z.string(),
          right: z.string(),
        },
      },
      async ({ left, right }) => {
        const leftId = assertRunId(left);
        const rightId = assertRunId(right);

        const leftBundle = await loadRunCompareBundleById(leftId);
        const rightBundle = await loadRunCompareBundleById(rightId);
        if (!leftBundle || !rightBundle) {
          return textContent({
            error: "run_not_found",
            left: leftId,
            right: rightId,
          });
        }

        return textContent({
          left: leftId,
          right: rightId,
          compare_url: `/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`,
          left_run_url: `/runs/${encodeURIComponent(leftId)}`,
          right_run_url: `/runs/${encodeURIComponent(rightId)}`,
        });
      },
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
  },
);

async function guardedHandler(request: Request): Promise<Response> {
  const decision = await enforceRateLimit(request);
  const rateHeaders = buildRateHeaders(decision);

  if (!decision.allowed) {
    const status = decision.statusCode || 429;
    return jsonWithHeaders(
      {
        error: decision.reason || "rate_limit_exceeded",
        retry_after_seconds: decision.retryAfterSeconds,
      },
      status,
      rateHeaders,
    );
  }

  const response = await mcpHandler(request);
  return responseWithHeaders(response, rateHeaders);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const decision = await enforceRateLimit(request);
  const headers = buildRateHeaders(decision);
  if (!decision.allowed) {
    const status = decision.statusCode || 429;
    return jsonWithHeaders(
      {
        error: decision.reason || "rate_limit_exceeded",
        retry_after_seconds: decision.retryAfterSeconds,
      },
      status,
      headers,
    );
  }
  return responseWithHeaders(new Response(null, { status: 204 }), headers);
}

export const GET = guardedHandler;
export const POST = guardedHandler;
export const DELETE = guardedHandler;
