import { describe, expect, it } from 'vitest';
import {
  applyNodeSelectionOperation,
  marqueeUsesContainment,
  selectionOperationFromModifiers,
} from './selectionOperations';

describe('selection operation algebra', () => {
  it('resolves modifiers without coupling Alt to containment', () => {
    expect(selectionOperationFromModifiers({ shiftKey: false, altKey: false })).toBe('replace');
    expect(selectionOperationFromModifiers({ shiftKey: true, altKey: false })).toBe('add');
    expect(selectionOperationFromModifiers({ shiftKey: false, altKey: true })).toBe('subtract');
    expect(selectionOperationFromModifiers({ shiftKey: true, altKey: true })).toBe('intersect');
  });

  it('uses Ctrl/Cmd only as a temporary containment toggle', () => {
    expect(marqueeUsesContainment(false, { ctrlKey: false, metaKey: false })).toBe(false);
    expect(marqueeUsesContainment(false, { ctrlKey: true, metaKey: false })).toBe(true);
    expect(marqueeUsesContainment(true, { ctrlKey: false, metaKey: true })).toBe(false);
    expect(marqueeUsesContainment(true, { ctrlKey: true, metaKey: true })).toBe(false);
  });

  it('preserves deterministic order and deduplicates candidates', () => {
    expect(applyNodeSelectionOperation(['a'], ['c', 'b', 'c'], 'replace')).toEqual(['c', 'b']);
    expect(applyNodeSelectionOperation(['a', 'b'], ['b', 'c', 'c'], 'add')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(applyNodeSelectionOperation(['a', 'b', 'c'], ['c', 'a'], 'subtract')).toEqual(['b']);
    expect(applyNodeSelectionOperation(['c', 'a', 'b'], ['b', 'a'], 'intersect')).toEqual([
      'a',
      'b',
    ]);
  });

  it('handles empty, identical, nested, and disjoint sets', () => {
    expect(applyNodeSelectionOperation(['a'], [], 'replace')).toEqual([]);
    expect(applyNodeSelectionOperation(['a'], [], 'add')).toEqual(['a']);
    expect(applyNodeSelectionOperation(['a'], ['a'], 'subtract')).toEqual([]);
    expect(applyNodeSelectionOperation(['a'], ['a'], 'intersect')).toEqual(['a']);
    expect(applyNodeSelectionOperation(['a'], ['b'], 'intersect')).toEqual([]);
  });
});
