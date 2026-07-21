import { describe, expect, it } from 'vitest';
import { evaluateRetention } from './retention';
import type { BackupIndexEntry, RetentionConfig } from './types';

function makeEntry(id: string, type: 'automatic' | 'snapshot', ageMs: number): BackupIndexEntry {
  return {
    id,
    type,
    createdAt: Date.now() - ageMs,
    size: 1000,
    documentSize: 800,
    verificationStatus: 'verified',
  };
}

describe('evaluateRetention', () => {
  it('keeps all entries within count budget', () => {
    const entries = [makeEntry('a', 'automatic', 1000), makeEntry('b', 'snapshot', 2000)];
    const config: RetentionConfig = {
      hourlyCount: 12,
      dailyCount: 7,
      weeklyCount: 4,
      monthlyCount: 3,
      maxTotalBytes: 1_000_000_000,
      maxEntryCount: 50,
    };
    const result = evaluateRetention(entries, config, 2000);
    expect(result.toRemove.length).toBe(0);
    expect(result.toKeep.length).toBe(2);
  });

  it('never removes snapshots', () => {
    const entries = [
      makeEntry('a', 'snapshot', 100_000_000),
      makeEntry('b', 'snapshot', 200_000_000),
      makeEntry('c', 'automatic', 1000),
    ];
    const config: RetentionConfig = {
      hourlyCount: 0,
      dailyCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      maxTotalBytes: 1_000_000_000,
      maxEntryCount: 2,
    };
    const result = evaluateRetention(entries, config, 3000);
    expect(result.toKeep).toContain('a');
    expect(result.toKeep).toContain('b');
  });

  it('removes automatic entries over count budget', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`auto-${i}`, 'automatic', i * 1000),
    );
    const config: RetentionConfig = {
      hourlyCount: 0,
      dailyCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      maxTotalBytes: 1_000_000_000,
      maxEntryCount: 3,
    };
    const result = evaluateRetention(entries, config, 10_000);
    expect(result.toRemove.length).toBeGreaterThan(0);
    expect(result.toKeep.length).toBeLessThanOrEqual(3);
  });

  it('frees space when over budget', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`big-${i}`, 'automatic', i * 1000),
    );
    for (const e of entries) {
      e.size = 1_000_000;
    }
    const config: RetentionConfig = {
      hourlyCount: 0,
      dailyCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      maxTotalBytes: 1_500_000,
      maxEntryCount: 50,
    };
    const result = evaluateRetention(entries, config, 5_000_000);
    expect(result.toRemove.length).toBeGreaterThan(0);
    expect(result.toKeep.length).toBeLessThan(5);
  });
});
