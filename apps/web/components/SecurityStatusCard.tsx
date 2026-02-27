import { CheckCircle2, XCircle } from "lucide-react";

import MetricPill from "@/components/MetricPill";

type SecurityStatus = {
  date_utc?: string;
  no_raw_zones_tracked?: boolean;
  no_ai_dir_tracked?: boolean;
  no_env_tracked?: boolean;
  last_local_run_id?: string;
  vercel_read_only?: boolean;
};

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
      <span>{label}</span>
    </li>
  );
}

export default function SecurityStatusCard({ status }: { status: SecurityStatus }) {
  const noRaw = Boolean(status.no_raw_zones_tracked);
  const noAi = Boolean(status.no_ai_dir_tracked);
  const noEnv = Boolean(status.no_env_tracked);
  const readOnly = Boolean(status.vercel_read_only);
  const safe = noRaw && noAi && noEnv && readOnly;

  return (
    <div className="rounded-xl border border-border/70 bg-card/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">Security Status</h3>
        <MetricPill tone={safe ? "safe" : "info"}>{safe ? "Safe aggregates" : "Check required"}</MetricPill>
      </div>
      <ul className="space-y-2">
        <StatusRow label="No raw zone files tracked" ok={noRaw} />
        <StatusRow label=".ai directory not tracked" ok={noAi} />
        <StatusRow label=".env files not tracked" ok={noEnv} />
        <StatusRow label="Web runtime is read-only" ok={readOnly} />
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        last_local_run_id: <span className="font-mono">{status.last_local_run_id || "n/a"}</span>
      </p>
    </div>
  );
}
