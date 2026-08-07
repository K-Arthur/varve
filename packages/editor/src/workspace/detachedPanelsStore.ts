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
    typeof r.panelInstanceId === 'string' &&
    typeof r.windowId === 'string' &&
    typeof r.generation === 'number'
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

export function isPanelDetached(panelTypeId: PanelTypeId): boolean {
  return records.some((r) => r.panelTypeId === panelTypeId);
}

export function markPanelDetached(
  panelTypeId: PanelTypeId,
  panelInstanceId: string,
  windowId: string,
): void {
  // Singleton panels: replace any existing record for the same type.
  records = records.filter((r) => r.panelTypeId !== panelTypeId);
  records.push({
    panelTypeId,
    panelInstanceId,
    windowId,
    generation: 1,
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
