export type NotifyInput = {
  webhookUrl: string | null;
  payload: Record<string, unknown>;
  dedupKey: string;
  timeoutMs: number;
  dryRun: boolean;
};

export async function notifyWebhook(input: NotifyInput): Promise<{
  delivered: boolean;
  status?: number;
  mode: "webhook" | "stdout" | "dry-run";
}> {
  const { webhookUrl, payload, dedupKey, timeoutMs, dryRun } = input;

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dry_run: true, dedup_key: dedupKey, payload }, null, 2));
    return { delivered: true, mode: "dry-run" };
  }

  if (!webhookUrl) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ stdout_only: true, dedup_key: dedupKey, payload }, null, 2));
    return { delivered: true, mode: "stdout" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "rootfetch-agent-monitor-js/0.1.0",
        "Idempotency-Key": dedupKey,
        "X-RootFetch-Dedup-Key": dedupKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Webhook ${response.status}: ${body.slice(0, 280)}`);
    }
    return { delivered: true, status: response.status, mode: "webhook" };
  } finally {
    clearTimeout(timer);
  }
}

