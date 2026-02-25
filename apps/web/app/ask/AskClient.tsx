"use client";

import { Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

import Callout from "@/components/Callout";
import Section from "@/components/Section";
import TrackedLink from "@/components/TrackedLink";
import { track } from "@/lib/analytics/ga";

type AskResponse = {
  query: string;
  k: number;
  hits_count: number;
  latency_ms: number;
  mode: "llm" | "deterministic";
  answer_draft: string;
  citations: Array<{
    id: string;
    source_type: string;
    source_path: string;
    resource_uri: string;
    date_utc: string | null;
    excerpt: string;
    score: number;
  }>;
};

const SUGGESTIONS = [
  "What changed today?",
  "Top 10 TLDs by share",
  "Explain HHI in this dataset",
  "Which approvals were newly added today?",
];

function citationHref(sourcePath: string): string {
  if (!sourcePath) {
    return "/rootfetch/latest.md";
  }
  if (sourcePath.endsWith("latest.md") || sourcePath.includes("digests")) {
    return "/rootfetch/latest.md";
  }
  if (sourcePath.includes("latest.json")) {
    return "/rootfetch/latest.json";
  }
  if (sourcePath.includes("coverage")) {
    return "/rootfetch/coverage_latest.json";
  }
  return "/rootfetch/latest.md";
}

export default function AskClient() {
  const [question, setQuestion] = useState("");
  const [k, setK] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);

  const promptLength = question.trim().length;

  const subtitle = useMemo(() => {
    if (!result) {
      return "Ask questions across static RootFetch artifacts. Answers include citations.";
    }
    return `Returned ${result.hits_count} evidence hits in ${result.latency_ms}ms (${result.mode}).`;
  }, [result]);

  const runAsk = async (nextQuestion?: string) => {
    const value = (nextQuestion ?? question).trim();
    if (!value) {
      setError("Enter a question first.");
      return;
    }

    setLoading(true);
    setError("");
    const started = performance.now();
    track("rf_ask_submit", { q_len: value.length, k });

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, k }),
      });
      if (!response.ok) {
        track("rf_api_error", { route: "/api/ask", status: response.status });
        throw new Error(`API ${response.status}`);
      }
      const payload = (await response.json()) as AskResponse;
      setResult(payload);
      track("rf_ask_results", {
        hits_count: payload.hits_count,
        latency_ms: Math.round(performance.now() - started),
      });
      track("rf_rag_search", {
        q_len: value.length,
        k,
        hits_count: payload.hits_count,
      });
    } catch {
      setError("Ask API failed. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-16 pt-8 md:px-8">
      <Section title="Ask RootFetch" subtitle={subtitle}>
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            type="text"
            value={question}
            data-testid="ask-input"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runAsk();
              }
            }}
            placeholder="Ask about approvals, movers, concentration, or coverage"
            className="h-11 rounded-lg border border-border/70 bg-background px-3 text-sm"
          />
          <select
            value={k}
            onChange={(event) => setK(Number(event.target.value))}
            className="h-11 rounded-lg border border-border/70 bg-background px-3 text-sm"
          >
            {[4, 6, 8, 10, 12].map((value) => (
              <option key={value} value={value}>
                Top {value} hits
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="ask-submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary/45 bg-primary/15 px-4 text-sm font-medium hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void runAsk()}
            disabled={loading}
          >
            <Search className="h-4 w-4" /> {loading ? "Searching" : "Ask"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:border-primary/40"
              onClick={() => {
                setQuestion(item);
                void runAsk(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">Question length: {promptLength}</p>
      </Section>

      {error ? <Callout variant="warning">{error}</Callout> : null}

      <Section title="Answer" subtitle="Evidence-first summary with explicit citations.">
        {result ? (
          <>
            <pre className="whitespace-pre-wrap rounded-lg border border-border/70 bg-background/70 p-4 text-sm leading-relaxed">
              {result.answer_draft}
            </pre>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-primary/40"
                onClick={async () => {
                  await navigator.clipboard.writeText(result.answer_draft);
                  track("rf_copy_value", { key: "ask_answer", context: "ask_page" });
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy answer
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-primary/40"
                onClick={async () => {
                  await navigator.clipboard.writeText(question);
                  track("rf_copy_value", { key: "ask_prompt", context: "ask_page" });
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy prompt
              </button>
            </div>

            <h3 className="mt-5 font-display text-base font-semibold">Citations</h3>
            {result.citations.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {result.citations.map((citation) => (
                  <li key={citation.id} className="rounded-lg border border-border/60 bg-background/70 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {citation.source_type} • {citation.source_path}
                    </p>
                    <p className="text-sm">{citation.excerpt}</p>
                    <div className="mt-2 flex gap-2">
                      <TrackedLink
                        href={citationHref(citation.source_path)}
                        label={`ask_citation_${citation.id}`}
                        pageType="ask"
                        eventName="rf_ask_citation_click"
                        eventParams={{
                          source_type: citation.source_type,
                          resource_uri_prefix: citation.resource_uri ? citation.resource_uri.slice(0, 40) : "none",
                        }}
                        className="text-xs text-primary hover:text-primary/80"
                      >
                        Open source
                      </TrackedLink>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          track("rf_rag_chunk_open", {
                            source_type: citation.source_type,
                            chunk_id_prefix: citation.id.slice(0, 16),
                          });
                        }}
                      >
                        Mark chunk opened
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Callout>No citations were returned for this question.</Callout>
            )}
          </>
        ) : (
          <Callout>Submit a question to see an answer draft and citations.</Callout>
        )}
      </Section>
    </main>
  );
}
