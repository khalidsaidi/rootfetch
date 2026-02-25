"use client";

import { motion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type StatCardProps = {
  label: string;
  value: number | string;
  hint?: string;
  tooltip?: string;
  className?: string;
  dataTestId?: string;
};

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export default function StatCard({ label, value, hint, tooltip, className, dataTestId }: StatCardProps) {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [display, setDisplay] = useState(numericValue ?? 0);
  const displayRef = useRef(display);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (numericValue === null) {
      return;
    }
    const start = displayRef.current;
    const end = numericValue;
    if (start === end) {
      return;
    }
    const durationMs = 700;
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = Math.round(start + (end - start) * eased);
      setDisplay(next);
      if (elapsed < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [numericValue]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn("rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm", className)}
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-1.5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        {tooltip ? (
          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`${label} explanation`} className="text-muted-foreground hover:text-foreground">
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">
        {numericValue === null ? value : formatInt(display)}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </motion.article>
  );
}
