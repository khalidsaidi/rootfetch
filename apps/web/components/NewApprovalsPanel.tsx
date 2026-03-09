"use client";

import { useMemo, useState } from "react";

import Badge from "@/components/Badge";
import Callout from "@/components/Callout";
import { track } from "@/lib/analytics/ga";

type ApprovalsPayload = {
  added_count?: number;
  removed_count?: number;
  added_preview?: string[];
  added_first_10?: string[];
  added?: string[];
};

export default function NewApprovalsPanel({ approvals }: { approvals: ApprovalsPayload }) {
  const [expanded, setExpanded] = useState(false);

  const addedCount = Number(approvals.added_count || 0);
  const removedCount = Number(approvals.removed_count || 0);
  const preview = useMemo(() => {
    if (Array.isArray(approvals.added_preview) && approvals.added_preview.length > 0) {
      return approvals.added_preview;
    }
    if (Array.isArray(approvals.added_first_10) && approvals.added_first_10.length > 0) {
      return approvals.added_first_10;
    }
    if (Array.isArray(approvals.added) && approvals.added.length > 0) {
      return approvals.added.slice(0, 10);
    }
    return [];
  }, [approvals]);

  if (addedCount <= 0 && removedCount <= 0) {
    return <Callout>No newly added TLDs in today’s universe diff snapshot.</Callout>;
  }

  return (
    <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="success">+{addedCount} added</Badge>
        <Badge tone="warning">-{removedCount} removed</Badge>
      </div>
      <p className="mt-2 text-sm text-emerald-100">{preview.length > 0 ? preview.join(", ") : "Added list unavailable"}</p>
      {Array.isArray(approvals.added) && approvals.added.length > preview.length ? (
        <button
          type="button"
          className="mt-2 rounded-md border border-emerald-300/40 px-2.5 py-1 text-xs text-emerald-100 hover:bg-emerald-500/20"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            track("rf_new_approvals_expand", { added_count: addedCount });
          }}
        >
          {expanded ? "Hide full list" : "Expand full list"}
        </button>
      ) : null}
      {expanded && Array.isArray(approvals.added) ? (
        <p className="mt-2 text-xs text-emerald-50">{approvals.added.join(", ")}</p>
      ) : null}
    </div>
  );
}
