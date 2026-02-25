import { cn } from "@/lib/utils";

export default function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
        : tone === "danger"
          ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
          : "border-primary/40 bg-primary/10 text-primary-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide",
        toneClass,
        className
      )}
    >
      {children}
    </span>
  );
}
