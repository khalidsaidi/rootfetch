"use client";

import { track } from "@/lib/analytics/ga";

export default function DownloadLinkButton({
  href,
  filename,
  label,
  kind,
  className,
}: {
  href: string;
  filename: string;
  label: string;
  kind: "top_tlds" | "sector_indices" | "tld_timeseries";
  className?: string;
}) {
  return (
    <button
      type="button"
      className={
        className || "rounded-md border border-border/70 px-3 py-1.5 text-xs hover:border-primary/40"
      }
      onClick={async () => {
        const response = await fetch(href, { cache: "no-store" });
        const text = await response.text();
        const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        track("rf_download_csv", { kind });
      }}
    >
      {label}
    </button>
  );
}
