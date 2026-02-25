import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide",
  {
    variants: {
      tone: {
        core: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
        rolling: "border-amber-400/40 bg-amber-500/10 text-amber-200",
        baseline: "border-violet-400/40 bg-violet-500/10 text-violet-200",
        snapshot: "border-slate-400/40 bg-slate-500/10 text-slate-200",
        safe: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
        info: "border-primary/40 bg-primary/10 text-primary-foreground",
      },
    },
    defaultVariants: {
      tone: "info",
    },
  }
);

type MetricPillProps = {
  children: React.ReactNode;
  className?: string;
} & VariantProps<typeof pillVariants>;

export default function MetricPill({ children, tone, className }: MetricPillProps) {
  return <span className={cn(pillVariants({ tone }), className)}>{children}</span>;
}
