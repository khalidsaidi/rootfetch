import { readFile } from "node:fs/promises";
import path from "node:path";

export type RagChunk = {
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
    if (idx >= 0) {
      break;
    }
  }
  if (idx < 0) {
    return text.slice(0, 220).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 200);
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

export async function loadRagChunks(): Promise<RagChunk[]> {
  if (ragChunksCache) {
    return ragChunksCache;
  }
  const filePath = path.join(ROOTFETCH_PUBLIC_DIR, "rag_chunks.json");
  const raw = await readFile(filePath, "utf-8");
  const payload = JSON.parse(raw) as RagChunksFile;
  ragChunksCache = Array.isArray(payload?.chunks) ? payload.chunks : [];
  return ragChunksCache;
}

export async function ragSearch({
  query,
  k = 8,
  sourceTypes,
}: {
  query: string;
  k?: number;
  sourceTypes?: string[];
}) {
  const chunks = await loadRagChunks();
  const queryTokens = tokenize(query);
  const sourceFilter = Array.isArray(sourceTypes) && sourceTypes.length > 0
    ? new Set(sourceTypes.map((item) => item.toLowerCase()))
    : null;

  const hits = chunks
    .filter((chunk) => {
      if (!sourceFilter) {
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

  return {
    query,
    k,
    hits,
  };
}

export function deterministicAnswerFromHits(question: string, hits: Array<{ excerpt: string; source_path: string; date_utc: string | null }>): string {
  if (hits.length === 0) {
    return `No direct evidence was found in current RootFetch artifacts for: "${question}".`;
  }

  const lines = [
    `Evidence-based summary for: "${question}"`,
    "",
    "Key points from indexed RootFetch artifacts:",
  ];

  hits.slice(0, 4).forEach((hit, idx) => {
    const source = hit.source_path || "unknown source";
    const date = hit.date_utc ? ` (${hit.date_utc})` : "";
    lines.push(`${idx + 1}. ${hit.excerpt} [${source}${date}]`);
  });

  lines.push("", "Use the citations to inspect full context.");
  return lines.join("\n");
}
