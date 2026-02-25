import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export default function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-background/70 p-5", className)}>
      <div className="mb-2 inline-flex rounded-full border border-primary/30 bg-primary/10 p-2 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
