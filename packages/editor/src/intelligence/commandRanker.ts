import type { ActionTracker } from './actionTracker';

export interface CommandRanking {
  topCommands: Array<{ actionId: string; count: number }>;
  underusedCommands: Array<{ actionId: string; count: number }>;
  totalActions: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const HIGH_VALUE_FEATURES = [
  'booleanUnion',
  'booleanSubtract',
  'group',
  'alignLeft',
  'distributeHorizontal',
  'harmonizeSpacing',
] as const;

export function rankCommands(tracker: ActionTracker, windowMs?: number): CommandRanking {
  const window = windowMs ?? THIRTY_DAYS_MS;
  const recentActions = tracker.getRecentActions(window);

  const freqMap = new Map<string, number>();
  for (const r of recentActions) {
    freqMap.set(r.actionId, (freqMap.get(r.actionId) ?? 0) + 1);
  }

  const sorted = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);

  const topCommands = sorted.slice(0, 10).map(([actionId, count]) => ({
    actionId,
    count,
  }));

  const underusedCommands: Array<{ actionId: string; count: number }> = [];
  for (const feature of HIGH_VALUE_FEATURES) {
    const count = freqMap.get(feature) ?? 0;
    if (count < 2) {
      underusedCommands.push({ actionId: feature, count });
    }
  }

  return {
    topCommands,
    underusedCommands: underusedCommands.sort((a, b) => a.count - b.count),
    totalActions: recentActions.length,
  };
}
