import { generateKeyBetween, generateNKeysBetween } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { planFileReorder } from './fileOrdering';

function file(id: string, ordering = '') {
  return {
    id,
    name: id,
    kind: 'strata' as const,
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering,
    contentHash: '',
  };
}

describe('planFileReorder', () => {
  it('backfills legacy empty keys and places the active file at the destination', () => {
    const writes = planFileReorder([file('a'), file('b'), file('c')], 'a', 'b');

    expect(writes).toHaveLength(3);
    expect(new Set(writes?.map((write) => write.ordering)).size).toBe(3);
    const byId = new Map(writes?.map((write) => [write.id, write.ordering]));
    expect(byId.get('a')).toBe(generateKeyBetween(byId.get('b')!, byId.get('c')!));
  });

  it('changes only the active key when existing keys are valid', () => {
    const [a, b, c] = generateNKeysBetween(null, null, 3);
    const writes = planFileReorder([file('a', a), file('b', b), file('c', c)], 'c', 'a');

    expect(writes).toEqual([
      { id: 'a', ordering: a },
      { id: 'b', ordering: b },
      { id: 'c', ordering: generateKeyBetween(null, a!) },
    ]);
  });

  it('returns no plan for stale or same-position destinations', () => {
    const files = [file('a', 'a0'), file('b', 'a1')];
    expect(planFileReorder(files, 'a', 'missing')).toBeNull();
    expect(planFileReorder(files, 'a', 'a')).toBeNull();
  });
});
