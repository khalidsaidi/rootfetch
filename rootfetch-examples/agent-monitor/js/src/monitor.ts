import { createHash } from "node:crypto";
import path from "node:path";

import { RootFetch } from "rootfetch-sdk-js";

import { notifyWebhook } from "./notify_webhook.js";
import { buildRunSnapshot, evaluatePolicies, type RunSnapshot } from "./policy.js";
import { isNotified, loadState, markNotified, pruneNotified, saveStateAtomic } from "./state.js";

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dedupKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function loadPreviousSnapshot(client: RootFetch, runId: string): Promise<RunSnapshot | null> {
  try {
    const prevRun = await client.run(runId);
    return buildRunSnapshot(runId, {}, prevRun as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const baseUrl = normalizeBaseUrl(process.env.ROOTFETCH_BASE_URL || "https://rootfetch.com");
  const webhookUrl = process.env.WEBHOOK_URL || null;
  const statePath = path.resolve(process.cwd(), process.env.ROOTFETCH_STATE_PATH || ".rootfetch-agent-state.json");
  const dviThreshold = asNumber(process.env.ROOTFETCH_DVI_THRESHOLD, 50);
  const topMoverZThreshold = asNumber(process.env.ROOTFETCH_TOP_MOVER_Z_THRESHOLD, 2.5);
  const dedupHours = asNumber(process.env.ROOTFETCH_DEDUP_HOURS, 168);
  const timeoutMs = Math.max(1000, Math.trunc(asNumber(process.env.ROOTFETCH_TIMEOUT_MS, 15000)));

  const state = await loadState(statePath);
  const now = new Date();
  pruneNotified(state, dedupHours, now);

  const client = new RootFetch({ baseUrl });
  const latest = (await client.latest()) as Record<string, unknown>;
  const runId = String(latest.run_id || "").trim();
  if (!runId) {
    throw new Error("latest() returned an empty run_id.");
  }

  const verification = await client.verifyManifest(runId);
  if (!verification.valid) {
    throw new Error(
      `Manifest verification failed for ${runId}. missing=${verification.missing_files.length} mismatched=${verification.mismatched_files.length}`,
    );
  }

  const runBundle = (await client.run(runId)) as Record<string, unknown>;
  const current = buildRunSnapshot(runId, latest, runBundle);
  const previousRunId = state.last_seen_run_id && state.last_seen_run_id !== runId ? state.last_seen_run_id : null;
  const previous = previousRunId ? await loadPreviousSnapshot(client, previousRunId) : null;

  const alerts = evaluatePolicies({
    current,
    previous,
    dviThreshold,
    topMoverZThreshold,
  });

  let delivered = 0;
  let skipped = 0;
  for (const alert of alerts) {
    const key = dedupKey([
      alert.policy_id,
      runId,
      current.snapshot_ts_utc,
      current.regime,
      String(Math.round(current.dvi * 10)),
      alert.summary,
    ]);
    if (isNotified(state, key)) {
      skipped += 1;
      continue;
    }

    const runUrl = `${baseUrl}/runs/${encodeURIComponent(runId)}`;
    const compareUrl = previousRunId
      ? `${baseUrl}/compare?left=${encodeURIComponent(previousRunId)}&right=${encodeURIComponent(runId)}`
      : null;

    const payload = {
      source: "rootfetch-agent-monitor-js",
      policy_id: alert.policy_id,
      severity: alert.severity,
      summary: alert.summary,
      details: alert.details,
      run_id: runId,
      snapshot_ts_utc: current.snapshot_ts_utc,
      model_version: current.model_version,
      regime: current.regime,
      dvi: Number(current.dvi.toFixed(1)),
      regime_confidence: Number(current.regime_confidence.toFixed(4)),
      links: {
        run_url: runUrl,
        compare_url: compareUrl,
      },
      dedup_key: key,
    } satisfies Record<string, unknown>;

    await notifyWebhook({
      webhookUrl,
      payload,
      dedupKey: key,
      timeoutMs,
      dryRun,
    });

    markNotified(state, key, now.toISOString());
    delivered += 1;
  }

  state.last_seen_run_id = runId;
  await saveStateAtomic(statePath, state);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        run_id: runId,
        previous_run_id: previousRunId,
        alerts_evaluated: alerts.length,
        alerts_delivered: delivered,
        alerts_skipped_dedup: skipped,
        dry_run: dryRun,
        state_path: statePath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

