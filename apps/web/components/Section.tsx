import { cn } from "@/lib/utils";

export default function Section({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur", className)}>
      <div className="mb-4">
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
