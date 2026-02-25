"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { track } from "@/lib/analytics/ga";
import { cn } from "@/lib/utils";

export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card/70 text-foreground backdrop-blur transition hover:border-primary/50 hover:text-primary",
        className
      )}
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
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
      <Sun className="absolute h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  );
}
