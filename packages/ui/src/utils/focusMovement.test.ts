/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { firstEnabledIndex, nextEnabledIndex } from './focusMovement';

describe('nextEnabledIndex', () => {
  it('moves to the next index', () => {
    expect(nextEnabledIndex(4, 0, 1, () => false)).toBe(1);
    expect(nextEnabledIndex(4, 3, 1, () => false)).toBe(0);
  });

  it('moves to the previous index with wrap', () => {
    expect(nextEnabledIndex(4, 0, -1, () => false)).toBe(3);
    expect(nextEnabledIndex(4, 2, -1, () => false)).toBe(1);
  });

  it('skips disabled items', () => {
    const disabled = new Set([1, 2]);
    const isDisabled = (i: number) => disabled.has(i);
    expect(nextEnabledIndex(5, 0, 1, isDisabled)).toBe(3);
    expect(nextEnabledIndex(5, 3, -1, isDisabled)).toBe(0);
  });

  it('wraps past the end skipping disabled items', () => {
    const disabled = new Set([1, 2]);
    const isDisabled = (i: number) => disabled.has(i);
    // from 4, forward: 0 is enabled (1,2 disabled)
    expect(nextEnabledIndex(5, 4, 1, isDisabled)).toBe(0);
    // from 3, forward: 4 enabled
    expect(nextEnabledIndex(5, 3, 1, isDisabled)).toBe(4);
  });

  it('stays put when every item is disabled', () => {
    expect(nextEnabledIndex(3, 1, 1, () => true)).toBe(1);
    expect(nextEnabledIndex(3, 1, -1, () => true)).toBe(1);
  });

  it('handles empty lists and negative indices', () => {
    expect(nextEnabledIndex(0, 0, 1, () => false)).toBe(0);
    expect(nextEnabledIndex(4, -1, 1, () => false)).toBe(0);
    // -1 normalizes to 3 (last); backward from there lands on 2.
    expect(nextEnabledIndex(4, -1, -1, () => false)).toBe(2);
  });
});

describe('firstEnabledIndex', () => {
  it('returns the first enabled index', () => {
    expect(firstEnabledIndex(4, (i) => i < 2)).toBe(2);
  });

  it('returns -1 when none are enabled', () => {
    expect(firstEnabledIndex(4, () => true)).toBe(-1);
  });

  it('returns 0 when all are enabled', () => {
    expect(firstEnabledIndex(4, () => false)).toBe(0);
  });
});
