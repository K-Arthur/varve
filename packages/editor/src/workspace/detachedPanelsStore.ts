/**
 * Detached panels store — which panel instances are currently hosted in
 * auxiliary windows (primary-window authority).
 *
 * A panel that is detached must not render in the primary window's dock.
 * Shell subscribes to this store and conditionally renders panels that
 * are NOT detached. The store is a plain pub-sub module (like
 * workspaceStore) so it does not add state to context.tsx (complexity
 * ceiling) and is usable from any window.
 */

import type { PanelTypeId } from './panelRegistry';

const STORAGE_KEY = 'varve-detached-panels';

export interface DetachedPanelRecord {
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  /** Window id of the auxiliary window hosting this panel. */
  windowId: string;
  /**
   * Ephemeral primary-process session that owns this host. Records from an
   * earlier application run are deliberately reattached instead of trying to
   * resurrect an untrusted/stale auxiliary webview.
   */
  sessionId?: string;
  /** Monotonic generation — a new window registration replaces old records. */
  generation: number;
  detachedAt: number;
}

type Listener = (records: DetachedPanelRecord[]) => void;

let records: DetachedPanelRecord[] = load();
const listeners = new Set<Listener>();

function load(): DetachedPanelRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

function isValidRecord(v: unknown): v is DetachedPanelRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.panelTypeId === 'string' &&
    r.panelTypeId.length > 0 &&
    typeof r.panelInstanceId === 'string' &&
    r.panelInstanceId.length > 0 &&
    typeof r.windowId === 'string' &&
    r.windowId.length > 0 &&
    (r.sessionId === undefined || (typeof r.sessionId === 'string' && r.sessionId.length > 0)) &&
    typeof r.generation === 'number' &&
    Number.isSafeInteger(r.generation) &&
    r.generation >= 1 &&
    typeof r.detachedAt === 'number' &&
    Number.isFinite(r.detachedAt)
  );
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // non-fatal
  }
  for (const listener of listeners) {
    listener([...records]);
  }
}

export function getDetachedPanels(): DetachedPanelRecord[] {
  return [...records];
}

export function getDetachedPanel(panelTypeId: PanelTypeId): DetachedPanelRecord | undefined {
  return records.find((record) => record.panelTypeId === panelTypeId);
}

export function isPanelDetached(panelTypeId: PanelTypeId): boolean {
  return records.some((r) => r.panelTypeId === panelTypeId);
}

export function markPanelDetached(
  panelTypeId: PanelTypeId,
  panelInstanceId: string,
  windowId: string,
  sessionId?: string,
): void {
  // Singleton panels: replace any existing record for the same type.
  const priorGeneration =
    records.find((record) => record.panelTypeId === panelTypeId)?.generation ?? 0;
  records = records.filter((r) => r.panelTypeId !== panelTypeId);
  records.push({
    panelTypeId,
    panelInstanceId,
    windowId,
    ...(sessionId ? { sessionId } : {}),
    generation: priorGeneration + 1,
    detachedAt: Date.now(),
  });
  persist();
}

export function markPanelReattached(panelTypeId: PanelTypeId): void {
  records = records.filter((r) => r.panelTypeId !== panelTypeId);
  persist();
}

export function clearDetachedPanels(): void {
  records = [];
  persist();
}

/**
 * Keep only records belonging to the current primary-process session.
 * Startup and a strict-mode remount both call this before deriving visible
 * panel state, which prevents a dead auxiliary host from hiding a docked
 * panel after a crash, restart, or reload.
 */
export function reconcileDetachedPanelsForSession(sessionId: string): DetachedPanelRecord[] {
  const next = records.filter((record) => record.sessionId === sessionId);
  if (next.length !== records.length) {
    records = next;
    persist();
  }
  return [...records];
}

export function subscribeDetachedPanels(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetDetachedPanelsStore(): void {
  records = [];
  persist();
}
