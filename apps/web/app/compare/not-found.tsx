import Link from "next/link";
import { AlertCircle } from "lucide-react";

import EmptyState from "@/components/EmptyState";

export default function CompareNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-16 pt-10 md:px-8">
      <div className="rf-glass rounded-2xl border border-border/60 p-6">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-amber-200">
          <AlertCircle className="h-4 w-4" />
          Compare target not found
        </div>
        <EmptyState
          title="Invalid run_id in compare query"
          description="Use /runs to select two valid immutable run IDs, then retry comparison."
        />
        <div className="mt-4">
          <Link
            href="/runs"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-sm hover:border-primary/50"
          >
            Back to run archive
          </Link>
        </div>
      </div>
    </main>
  );
}

