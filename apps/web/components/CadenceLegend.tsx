import MetricPill from "@/components/MetricPill";

export default function CadenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MetricPill tone="core">Core: daily recounted</MetricPill>
      <MetricPill tone="rolling">Rolling: recounted on rotation</MetricPill>
      <MetricPill tone="baseline">Baseline: full sweep/catch-up</MetricPill>
      <MetricPill tone="snapshot">Snapshot: carried forward</MetricPill>
    </div>
  );
}
