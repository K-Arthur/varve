import { useEffect, useMemo, useState } from 'react';
import { getActionTracker, type ActionRecord } from '../intelligence/actionTracker';

export interface ShortcutUsage {
  actionId: string;
  count: number;
  lastUsed: number | null;
  recentCount: number; // last 7 days
}

export interface ShortcutUsageSnapshot {
  usages: Map<string, ShortcutUsage>;
  totalActions: number;
  /** Actions that have never been used (no records in the tracker). */
  neverUsed: string[];
  /** Actions used at least once but not in the last 30 days. */
  rarelyUsed: string[];
  /** Actions used in the last 24 hours. */
  recentlyUsed: string[];
  version: number;
}

const WINDOW_7_DAYS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_30_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Snapshot model for shortcut usage data.
 *
 * Provides a clean data boundary between ActionTracker and the shortcut UI.
 * The palette subscribes to this snapshot rather than directly to high-frequency
 * action events. A version counter increments whenever the underlying data
 * changes, enabling efficient memo invalidation.
 */
export function useShortcutUsage(actionIds: string[]): ShortcutUsageSnapshot {
  const tracker = useMemo(() => getActionTracker(), []);

  const [version, setVersion] = useState(0);

  // Re-sync when actions are recorded. We poll at a low frequency instead of
  // subscribing to every record() call to avoid re-rendering the palette on
  // every user action.
  useEffect(() => {
    const interval = setInterval(() => {
      setVersion((v) => v + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const usages = new Map<string, ShortcutUsage>();
    const allRecords: ActionRecord[] = tracker.getRecentActions(WINDOW_30_DAYS);

    // Build per-action stats
    const countMap = new Map<string, number>();
    const recentCountMap = new Map<string, number>();
    const lastUsedMap = new Map<string, number>();

    for (const r of allRecords) {
      countMap.set(r.actionId, (countMap.get(r.actionId) ?? 0) + 1);
      if (now - r.timestamp < WINDOW_7_DAYS) {
        recentCountMap.set(r.actionId, (recentCountMap.get(r.actionId) ?? 0) + 1);
      }
      const prev = lastUsedMap.get(r.actionId);
      if (!prev || r.timestamp > prev) {
        lastUsedMap.set(r.actionId, r.timestamp);
      }
    }

    const neverUsed: string[] = [];
    const rarelyUsed: string[] = [];
    const recentlyUsed: string[] = [];

    for (const id of actionIds) {
      const count = countMap.get(id) ?? 0;
      const recentCount = recentCountMap.get(id) ?? 0;
      const lastUsed = lastUsedMap.get(id) ?? null;

      usages.set(id, { actionId: id, count, lastUsed, recentCount });

      if (count === 0) {
        neverUsed.push(id);
      } else if (now - (lastUsed ?? 0) > WINDOW_30_DAYS) {
        rarelyUsed.push(id);
      }
      if (recentCount > 0 && lastUsed && now - lastUsed < 24 * 60 * 60 * 1000) {
        recentlyUsed.push(id);
      }
    }

    return {
      usages,
      totalActions: tracker.getTotalCount(),
      neverUsed,
      rarelyUsed,
      recentlyUsed,
      version,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionIds, tracker, version]);
}
