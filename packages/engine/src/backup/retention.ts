import type { BackupIndexEntry, BackupType, RetentionConfig } from './types';

export interface RetentionResult {
  toRemove: string[];
  toKeep: string[];
  reason: string;
}

export function evaluateRetention(
  entries: BackupIndexEntry[],
  config: RetentionConfig,
  _currentTotalBytes: number,
): RetentionResult {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const toRemove: string[] = [];
  const toKeep: string[] = [];

  if (sorted.length <= config.maxEntryCount && _currentTotalBytes <= config.maxTotalBytes) {
    return {
      toRemove: [],
      toKeep: sorted.map((e) => e.id),
      reason: 'Within count and byte budgets',
    };
  }

  const keepSet = new Set<string>();
  const plan: Array<{ ids: string[]; tier: string; limit: number }> = [];

  if (config.hourlyCount > 0) {
    plan.push({
      ids: pickByAge(sorted, 60 * 60 * 1000, config.hourlyCount),
      tier: 'hourly',
      limit: config.hourlyCount,
    });
  }
  if (config.dailyCount > 0) {
    plan.push({
      ids: pickByAge(sorted, 24 * 60 * 60 * 1000, config.dailyCount),
      tier: 'daily',
      limit: config.dailyCount,
    });
  }
  if (config.weeklyCount > 0) {
    plan.push({
      ids: pickByAge(sorted, 7 * 24 * 60 * 60 * 1000, config.weeklyCount),
      tier: 'weekly',
      limit: config.weeklyCount,
    });
  }
  if (config.monthlyCount > 0) {
    plan.push({
      ids: pickByAge(sorted, 30 * 24 * 60 * 60 * 1000, config.monthlyCount),
      tier: 'monthly',
      limit: config.monthlyCount,
    });
  }

  for (const tier of plan) {
    for (const id of tier.ids) {
      keepSet.add(id);
    }
  }

  for (const entry of sorted) {
    if (keepSet.has(entry.id) || !canRemove(entry.type)) {
      toKeep.push(entry.id);
    } else {
      toRemove.push(entry.id);
    }
  }

  let keepBytes = 0;
  for (const entry of sorted) {
    if (toKeep.includes(entry.id)) {
      keepBytes += entry.size;
    }
  }

  if (keepBytes > config.maxTotalBytes) {
    const removalCandidates = sorted.filter((e) => toRemove.includes(e.id));
    for (const entry of removalCandidates) {
      if (keepBytes <= config.maxTotalBytes) break;
      if (toKeep.length <= 1) break;
      toRemove.push(entry.id);
      toKeep.splice(toKeep.indexOf(entry.id), 1);
      keepBytes -= entry.size;
    }
  }

  return { toRemove, toKeep, reason: `Kept ${toKeep.length} entries` };
}

function pickByAge(entries: BackupIndexEntry[], windowMs: number, maxCount: number): string[] {
  const now = Date.now();
  const inWindow = entries.filter((e) => now - e.createdAt <= windowMs);
  const selected: string[] = [];
  const seenBuckets = new Set<string>();
  for (const entry of inWindow) {
    if (selected.length >= maxCount) break;
    const bucket = bucketKey(entry.createdAt, windowMs);
    if (!seenBuckets.has(bucket)) {
      seenBuckets.add(bucket);
      selected.push(entry.id);
    }
  }
  return selected;
}

function bucketKey(timestamp: number, windowMs: number): string {
  if (windowMs <= 60 * 60 * 1000) return `h${Math.floor(timestamp / (60 * 60 * 1000))}`;
  if (windowMs <= 24 * 60 * 60 * 1000) return `d${Math.floor(timestamp / (24 * 60 * 60 * 1000))}`;
  if (windowMs <= 7 * 24 * 60 * 60 * 1000)
    return `w${Math.floor(timestamp / (7 * 24 * 60 * 60 * 1000))}`;
  return `m${Math.floor(timestamp / (30 * 24 * 60 * 60 * 1000))}`;
}

function canRemove(type: BackupType): boolean {
  return type === 'automatic' || type === 'bulk';
}
