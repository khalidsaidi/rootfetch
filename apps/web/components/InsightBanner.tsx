import { Activity, ArrowUp, Globe2, ShieldCheck } from "lucide-react";

type Insight = {
  kind: string;
  severity: string;
  text: string;
};

function iconFor(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized === "movers") return ArrowUp;
  if (normalized === "coverage") return ShieldCheck;
  if (normalized === "approvals") return Globe2;
  return Activity;
}

function toneFor(severity: string): string {
  const normalized = severity.toLowerCase();
  if (normalized === "positive") return "border-emerald-400/30 bg-emerald-500/10";
  if (normalized === "warning") return "border-amber-400/30 bg-amber-500/10";
  return "border-border/60 bg-card/70";
}

export default function InsightBanner({ insights }: { insights: Insight[] }) {
  if (!insights.length) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur">
      <h2 className="mb-3 font-display text-lg font-semibold">Daily Narrative</h2>
      <div className="grid gap-2 md:grid-cols-2">
        {insights.map((item) => {
          const Icon = iconFor(item.kind);
          return (
            <div key={`${item.kind}-${item.text.slice(0, 24)}`} className={`rounded-lg border p-3 ${toneFor(item.severity)}`}>
              <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {item.kind}
              </div>
              <p className="text-sm">{item.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
