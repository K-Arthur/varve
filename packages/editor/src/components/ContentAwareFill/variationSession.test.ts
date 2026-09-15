import { describe, expect, it } from 'vitest';
import { mergeGenerativeVariations } from './variationSession';

const candidate = (id: string) => ({ id });

describe('mergeGenerativeVariations', () => {
  it('keeps the active previous candidate when regeneration fills the history bound', () => {
    const merged = mergeGenerativeVariations(
      ['old-1', 'old-2', 'old-3', 'old-4'].map(candidate),
      ['new-1', 'new-2', 'new-3', 'new-4'].map(candidate),
      'old-2',
      8,
    );

    expect(merged.map(({ id }) => id)).toEqual([
      'old-1',
      'old-2',
      'old-3',
      'old-4',
      'new-1',
      'new-2',
      'new-3',
      'new-4',
    ]);
  });

  it('bounds history while retaining the previous active candidate and newest result', () => {
    const merged = mergeGenerativeVariations(
      ['old-1', 'old-2', 'old-3', 'old-4', 'old-5'].map(candidate),
      ['new-1', 'new-2', 'new-3'].map(candidate),
      'old-1',
      4,
    );

    expect(merged.map(({ id }) => id)).toEqual(['old-1', 'new-1', 'new-2', 'new-3']);
    expect(merged).not.toContainEqual({ id: 'old-5' });
  });

  it('uses the incoming value when a candidate id is regenerated', () => {
    const merged = mergeGenerativeVariations(
      [{ id: 'same', seed: 1 }, { id: 'old' }],
      [{ id: 'same', seed: 2 }, { id: 'new' }],
      'old',
      4,
    );

    expect(merged).toEqual([{ id: 'same', seed: 2 }, { id: 'old' }, { id: 'new' }]);
  });
});
