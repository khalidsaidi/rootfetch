import Link from "next/link";
import { AlertCircle, ExternalLink } from "lucide-react";

import EmptyState from "@/components/EmptyState";

export default function RunNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-16 pt-10 md:px-8">
      <div className="rf-glass rounded-2xl border border-border/60 p-6">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-amber-200">
          <AlertCircle className="h-4 w-4" />
          Run not found
        </div>
        <EmptyState
          title="Run ID does not exist in immutable artifacts"
          description="Use replay index or latest pointer to discover valid run IDs, then open /runs/<run_id>."
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/rootfetch/artifacts/replay/index.json"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-sm hover:border-primary/50"
          >
            View replay index <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/rootfetch/artifacts/latest.json"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-sm hover:border-primary/50"
          >
            Fetch latest run pointer <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </main>
  );
}

