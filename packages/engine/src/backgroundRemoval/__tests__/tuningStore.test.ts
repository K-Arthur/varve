import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadTuningProfiles,
  saveTuningProfile,
  deleteTuningProfile,
  getTuningStats,
} from '../tuningStore';
import type { CategoryProfile } from '../categoryTuning';

beforeEach(() => {
  localStorage.clear();
});

function makeProfile(id: string, name: string): CategoryProfile {
  return {
    categoryId: id,
    name,
    preferredModel: 'u2netp',
    threshold: 0.5,
    useCount: 1,
    lastUsedAt: Date.now(),
    satisfactionScore: 0.8,
  };
}

describe('tuningStore', () => {
  it('saves and loads a profile round-trip correctly', () => {
    const profile = makeProfile('p1', 'Product Photos');
    saveTuningProfile(profile);

    const loaded = loadTuningProfiles();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.categoryId).toBe('p1');
    expect(loaded[0]!.name).toBe('Product Photos');
    expect(loaded[0]!.preferredModel).toBe('u2netp');
    expect(loaded[0]!.threshold).toBe(0.5);
    expect(loaded[0]!.useCount).toBe(1);
  });

  it('deletes a profile by ID', () => {
    saveTuningProfile(makeProfile('p1', 'One'));
    saveTuningProfile(makeProfile('p2', 'Two'));
    expect(loadTuningProfiles()).toHaveLength(2);

    deleteTuningProfile('p1');
    const loaded = loadTuningProfiles();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.categoryId).toBe('p2');
  });

  it('saves and loads multiple profiles', () => {
    const profiles = [makeProfile('a', 'A'), makeProfile('b', 'B'), makeProfile('c', 'C')];
    for (const p of profiles) {
      saveTuningProfile(p);
    }

    const loaded = loadTuningProfiles();
    expect(loaded).toHaveLength(3);
    const ids = loaded.map((p) => p.categoryId).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty store', () => {
    const loaded = loadTuningProfiles();
    expect(loaded).toEqual([]);
  });

  it('getTuningStats returns correct aggregates', () => {
    const p1 = makeProfile('p1', 'One');
    p1.useCount = 5;
    p1.satisfactionScore = 0.9;
    saveTuningProfile(p1);

    const p2 = makeProfile('p2', 'Two');
    p2.useCount = 3;
    p2.satisfactionScore = 0.7;
    saveTuningProfile(p2);

    const stats = getTuningStats();
    expect(stats.totalProfiles).toBe(2);
    expect(stats.totalUses).toBe(8);
    expect(stats.avgSatisfaction).toBeCloseTo(0.8);
  });

  it('getTuningStats returns zeros for empty store', () => {
    const stats = getTuningStats();
    expect(stats.totalProfiles).toBe(0);
    expect(stats.totalUses).toBe(0);
    expect(stats.avgSatisfaction).toBe(0);
  });
});
