import { describe, expect, it } from 'vitest';
import { applySelectionRange, selectionRangeBetween } from './selectionRange';

const entries = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

describe('selection range algebra', () => {
  it('resolves forward and reversed ranges by stable IDs', () => {
    expect(selectionRangeBetween(entries, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectionRangeBetween(entries, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('falls back to the extent when a virtualized anchor is no longer visible', () => {
    expect(selectionRangeBetween(entries, 'missing', 'c')).toEqual(['c']);
  });

  it('applies a scrub from one immutable selection snapshot', () => {
    expect(applySelectionRange(['a', 'e'], ['b', 'c', 'd'], 'replace')).toEqual(['b', 'c', 'd']);
    expect(applySelectionRange(['a', 'e'], ['b', 'c', 'd'], 'add')).toEqual([
      'a',
      'e',
      'b',
      'c',
      'd',
    ]);
    expect(applySelectionRange(['a', 'b', 'e'], ['b', 'c', 'd'], 'subtract')).toEqual(['a', 'e']);
  });
});
