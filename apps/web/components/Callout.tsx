import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

export default function Callout({
  children,
  variant = "info",
  className,
}: {
  children: React.ReactNode;
  variant?: "info" | "warning";
  className?: string;
}) {
  const Icon = variant === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground",
        variant === "warning" ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "",
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-none" />
      <div>{children}</div>
    </div>
  );
}
