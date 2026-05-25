import { loadLatest } from "@/lib/rootfetch-data";
import { deterministicAnswerFromHits, ragSearch } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AskPayload = {
  question?: string;
  k?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function maybeGenerateLlmAnswer({
  question,
  citations,
}: {
  question: string;
  citations: Array<{ excerpt: string; source_path: string; date_utc: string | null }>;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const evidenceBlock = citations
    .slice(0, 6)
    .map((item, idx) => {
      const date = item.date_utc ? ` (${item.date_utc})` : "";
      return `[${idx + 1}] ${item.excerpt}\nSource: ${item.source_path}${date}`;
    })
    .join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.ROOTFETCH_ASK_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are RootFetch Assistant. Use only provided evidence. If evidence is insufficient, state that clearly. Keep response concise and cite evidence ids like [1].",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nEvidence:\n${evidenceBlock}`,
          },
        ],
        max_output_tokens: 320,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { output_text?: string };
    if (payload.output_text && payload.output_text.trim()) {
      return payload.output_text.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  let body: AskPayload = {};
  try {
    body = (await request.json()) as AskPayload;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const question = (body.question || "").trim();
  if (!question) {
    return json({ error: "question_required" }, 400);
  }
  if (question.length > 1000) {
    return json({ error: "question_too_long" }, 400);
  }

  const k = clamp(Number(body.k || 6), 1, 20);

  try {
    const search = await ragSearch({ query: question, k });
    const citations = search.hits.map((hit) => ({
      id: hit.id,
      source_type: hit.source_type,
      source_path: hit.source_path,
      resource_uri: hit.resource_uri,
      date_utc: hit.date_utc,
      excerpt: hit.excerpt,
      score: hit.score,
    }));

    const deterministic = deterministicAnswerFromHits(question, citations);
    const llmAnswer = await maybeGenerateLlmAnswer({ question, citations });
    const answerDraft = llmAnswer || deterministic;
    const latest = await loadLatest().catch(() => null);
    const computedFacts = latest
      ? {
          date_utc: latest.date_utc,
          approved_tlds_count: latest.approved_tlds_count,
          observed_today_count: latest.counted_today_count,
          snapshot_rows_today: latest.snapshot_rows_today,
          top10_share_pct: latest.concentration?.top10_share_pct ?? null,
          hhi: latest.concentration?.hhi ?? null,
          new_approvals_added_count: latest.approvals_diff?.added_count ?? null,
        }
      : {};

    return json({
      query: question,
      k,
      hits_count: citations.length,
      latency_ms: Date.now() - started,
      mode: llmAnswer ? "llm" : "deterministic",
      answer: answerDraft,
      answer_draft: answerDraft,
      citations,
      computed_facts: computedFacts,
    });
  } catch {
    return json(
      {
        error: "ask_failed",
      },
      500,
    );
  }
}
