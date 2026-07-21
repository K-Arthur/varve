// @ts-nocheck
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionTracker } from './actionTracker';
import { detectPatterns } from './workflowAnalyzer';

describe('workflowAnalyzer', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  function recordSequence(actions: string[]): void {
    const base = Date.now();
    let callCount = 0;
    const mock = vi.spyOn(Date, 'now');
    mock.mockImplementation(() => {
      callCount++;
      return base + callCount * 200;
    });
    for (const a of actions) {
      tracker.record(a);
    }
    mock.mockRestore();
  }

  it('detects trigram createShape → setFill → setStroke pattern', () => {
    recordSequence([
      'createShape',
      'setFill',
      'setStroke',
      'createShape',
      'setFill',
      'setStroke',
      'createShape',
      'setFill',
      'setStroke',
    ]);

    const result = detectPatterns(tracker);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const pattern = result.find(
      (p) =>
        p.sequence[0] === 'createShape' &&
        p.sequence[1] === 'setFill' &&
        p.sequence[2] === 'setStroke',
    );
    expect(pattern).toBeDefined();
    expect(pattern!.frequency).toBe(3);
    expect(pattern!.suggestion).toBe('Create a style?');
  });

  it('detects copy → paste bigram pattern', () => {
    recordSequence(['copy', 'paste', 'copy', 'paste', 'copy', 'paste']);

    const result = detectPatterns(tracker);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const pattern = result.find((p) => p.sequence[0] === 'copy' && p.sequence[1] === 'paste');
    expect(pattern).toBeDefined();
    expect(pattern!.frequency).toBe(3);
    expect(pattern!.suggestion).toBe('Use duplicate (Ctrl+D) instead');
  });

  it('detects tool:select → tool:X → tool:select trigram pattern', () => {
    recordSequence([
      'tool:select',
      'tool:rect',
      'tool:select',
      'tool:select',
      'tool:rect',
      'tool:select',
      'tool:select',
      'tool:rect',
      'tool:select',
    ]);

    const result = detectPatterns(tracker);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const pattern = result.find(
      (p) =>
        p.sequence[0] === 'tool:select' &&
        p.sequence[1] === 'tool:rect' &&
        p.sequence[2] === 'tool:select',
    );
    expect(pattern).toBeDefined();
    expect(pattern!.frequency).toBe(3);
    expect(pattern!.suggestion).toBe('Add shortcut for rect tool');
  });

  it('does not detect patterns with frequency < 3', () => {
    recordSequence(['tool:select', 'tool:rect', 'tool:line']);

    const result = detectPatterns(tracker);
    expect(result).toEqual([]);
  });

  it('does not detect patterns with only one distinct action', () => {
    recordSequence(['setFill', 'setFill', 'setFill', 'setFill', 'setFill']);

    const result = detectPatterns(tracker);
    const fillPattern = result.filter((p) => p.sequence.every((a) => a === 'setFill'));
    expect(fillPattern).toEqual([]);
  });

  it('returns empty for empty tracker', () => {
    const result = detectPatterns(tracker);
    expect(result).toEqual([]);
  });

  it('returns empty for single action', () => {
    recordSequence(['tool:select']);

    const result = detectPatterns(tracker);
    expect(result).toEqual([]);
  });

  it('sorts patterns by frequency descending', () => {
    recordSequence([
      'copy',
      'paste',
      'copy',
      'paste',
      'copy',
      'paste',
      'tool:select',
      'tool:rect',
      'tool:select',
      'tool:select',
      'tool:rect',
      'tool:select',
      'tool:select',
      'tool:rect',
      'tool:select',
    ]);

    const result = detectPatterns(tracker);
    // copy → paste appears 3 times, tool:select → tool:rect → tool:select appears 3 times
    // Both have same frequency, make sure they're sorted
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].frequency).toBeGreaterThanOrEqual(result[i].frequency);
    }
  });

  it('is deterministic given same input', () => {
    recordSequence([
      'createShape',
      'setFill',
      'setStroke',
      'createShape',
      'setFill',
      'setStroke',
      'createShape',
      'setFill',
      'setStroke',
    ]);

    const result1 = detectPatterns(tracker);
    const result2 = detectPatterns(tracker);
    expect(result1).toEqual(result2);
  });
});
