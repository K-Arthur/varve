// @ts-nocheck
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionTracker } from './actionTracker';
import { rankCommands } from './commandRanker';

describe('commandRanker', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  it('returns top 10 most used commands sorted by frequency descending', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 20; i++) tracker.record('tool:select');
    for (let i = 0; i < 15; i++) tracker.record('setFill');
    for (let i = 0; i < 10; i++) tracker.record('menu:group');

    const result = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result.topCommands.length).toBeLessThanOrEqual(10);
    expect(result.topCommands[0].actionId).toBe('tool:select');
    expect(result.topCommands[0].count).toBe(20);
    vi.restoreAllMocks();
  });

  it('identifies underused high-value features with count < 2', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    tracker.record('booleanUnion');
    tracker.record('booleanUnion');
    tracker.record('group');
    tracker.record('group');
    tracker.record('group');

    const result = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result.underusedCommands.some((c) => c.actionId === 'booleanSubtract')).toBe(true);
    expect(result.underusedCommands.some((c) => c.actionId === 'alignLeft')).toBe(true);
    expect(result.underusedCommands.some((c) => c.actionId === 'distributeHorizontal')).toBe(true);
    expect(result.underusedCommands.some((c) => c.actionId === 'harmonizeSpacing')).toBe(true);
    expect(result.underusedCommands.some((c) => c.actionId === 'booleanUnion')).toBe(false);
    expect(result.underusedCommands.some((c) => c.actionId === 'group')).toBe(false);
    vi.restoreAllMocks();
  });

  it('reports total action count within window', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    tracker.record('tool:select');
    tracker.record('setFill');

    const result = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result.totalActions).toBe(2);
    vi.restoreAllMocks();
  });

  it('handles empty tracker', () => {
    const result = rankCommands(tracker);
    expect(result.topCommands).toEqual([]);
    expect(result.underusedCommands.length).toBeGreaterThanOrEqual(6);
    expect(result.totalActions).toBe(0);
  });

  it('limits topCommands to at most 10 entries', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 15; i++) {
      tracker.record(`tool:${i}`);
    }

    const result = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result.topCommands.length).toBe(10);
    vi.restoreAllMocks();
  });

  it('excludes high-value features with count >= 2 from underused', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 5; i++) tracker.record('group');
    for (let i = 0; i < 3; i++) tracker.record('alignLeft');

    const result = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result.underusedCommands.some((c) => c.actionId === 'group')).toBe(false);
    expect(result.underusedCommands.some((c) => c.actionId === 'alignLeft')).toBe(false);
    expect(result.underusedCommands.some((c) => c.actionId === 'booleanUnion')).toBe(true);
    vi.restoreAllMocks();
  });

  it('is deterministic given same input', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 10; i++) tracker.record('tool:select');
    for (let i = 0; i < 5; i++) tracker.record('setFill');

    const result1 = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    const result2 = rankCommands(tracker, 7 * 24 * 60 * 60 * 1000);
    expect(result1).toEqual(result2);
    vi.restoreAllMocks();
  });
});
