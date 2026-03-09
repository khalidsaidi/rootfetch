"use client";

import { BookOpenText } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { track } from "@/lib/analytics/ga";

export default function SnapshotExplainer() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1 text-xs hover:border-primary/40"
          onClick={() => track("rf_copy_value", { key: "observed_snapshot_explainer_open", context: "home" })}
        >
          <BookOpenText className="h-3.5 w-3.5" />
          What does observed mean?
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Observed vs Snapshot Rows</DialogTitle>
          <DialogDescription>
            RootFetch keeps daily freshness while maintaining complete coverage artifacts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="font-medium">Snapshot rows today</p>
            <p className="mt-1 text-muted-foreground">
              We keep a current snapshot row for every tracked TLD in committed artifacts.
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="font-medium">Observed today</p>
            <p className="mt-1 text-muted-foreground">
              These are the TLDs actually downloaded and recounted today from core + rolling cadence.
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="font-medium">Why this split exists</p>
            <p className="mt-1 text-muted-foreground">
              Hybrid cadence keeps local ingestion costs sane while preserving complete and queryable coverage.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
