export default function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-xl font-semibold tracking-tight break-all [overflow-wrap:anywhere]">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground break-all [overflow-wrap:anywhere]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
