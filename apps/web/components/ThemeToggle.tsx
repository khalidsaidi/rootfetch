"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { track } from "@/lib/analytics/ga";
import { cn } from "@/lib/utils";

export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card/70 text-foreground backdrop-blur transition hover:border-primary/50 hover:text-primary",
        className
      )}
      onClick={() => {
        const next = isDark ? "light" : "dark";
        setTheme(next);
        track("rf_market_filter", {
          filter_key: "theme",
          filter_value: next,
          value: next,
        });
      }}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
