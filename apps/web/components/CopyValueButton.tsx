"use client";

import { Copy } from "lucide-react";

import { track } from "@/lib/analytics/ga";

export default function CopyValueButton({
  value,
  keyName,
  context,
}: {
  value: string;
  keyName: string;
  context: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs hover:border-primary/50"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        track("rf_copy_value", { key: keyName, context });
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      copy
    </button>
  );
}
