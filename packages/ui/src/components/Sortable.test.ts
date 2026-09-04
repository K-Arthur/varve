import { describe, expect, it } from 'vitest';
import { reorderSortableItems } from './Sortable';

describe('reorderSortableItems', () => {
  it('moves stable IDs to the destination position', () => {
    expect(reorderSortableItems(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorderSortableItems(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('rejects no-op, missing, and cancelled drops', () => {
    expect(reorderSortableItems(['a', 'b'], 'a', 'a')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'missing', 'a')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'a', 'missing')).toBeNull();
    expect(reorderSortableItems(['a', 'b'], 'a', null)).toBeNull();
  });

  it('does not mutate the caller-owned list', () => {
    const items = ['a', 'b', 'c'];
    reorderSortableItems(items, 'b', 'c');
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
