import { open, readFile, rename } from "node:fs/promises";
import path from "node:path";

export type AgentState = {
  last_seen_run_id: string | null;
  notified_keys: Record<string, string>;
};

const EMPTY_STATE: AgentState = {
  last_seen_run_id: null,
  notified_keys: {},
};

function normalizeState(raw: unknown): AgentState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }
  const record = raw as Record<string, unknown>;
  const keysRaw = record.notified_keys;
  const normalizedKeys: Record<string, string> = {};
  if (keysRaw && typeof keysRaw === "object") {
    for (const [key, value] of Object.entries(keysRaw as Record<string, unknown>)) {
      if (typeof key === "string" && typeof value === "string") {
        normalizedKeys[key] = value;
      }
    }
  }
  return {
    last_seen_run_id: typeof record.last_seen_run_id === "string" ? record.last_seen_run_id : null,
    notified_keys: normalizedKeys,
  };
}

export async function loadState(filePath: string): Promise<AgentState> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function isNotified(state: AgentState, dedupKey: string): boolean {
  return typeof state.notified_keys[dedupKey] === "string";
}

export function markNotified(state: AgentState, dedupKey: string, nowIso: string): void {
  state.notified_keys[dedupKey] = nowIso;
}

export function pruneNotified(state: AgentState, maxAgeHours: number, now: Date): void {
  const maxAgeMs = Math.max(1, maxAgeHours) * 60 * 60 * 1000;
  for (const [key, iso] of Object.entries(state.notified_keys)) {
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts) || now.getTime() - ts > maxAgeMs) {
      delete state.notified_keys[key];
    }
  }
}

export async function saveStateAtomic(filePath: string, state: AgentState): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";

  const tempHandle = await open(tmpPath, "w");
  try {
    await tempHandle.writeFile(payload, "utf-8");
    await tempHandle.sync();
  } finally {
    await tempHandle.close();
  }

  await rename(tmpPath, filePath);

  const dirHandle = await open(dir, "r");
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

