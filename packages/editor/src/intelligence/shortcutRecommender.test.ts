// @ts-nocheck
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionTracker } from './actionTracker';
import { recommendShortcuts } from './shortcutRecommender';

describe('shortcutRecommender', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  it('recommends shortcut for menu action used 12 times without shortcut usage', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 12; i++) {
      tracker.record('menu:alignLeft');
    }

    const result = recommendShortcuts(tracker);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].actionId).toBe('menu:alignLeft');
    expect(result[0].usageCount).toBe(12);
    expect(result[0].message).toContain('Align left');
    expect(result[0].message).toContain('12');
    vi.restoreAllMocks();
  });

  it('does not recommend when user already knows the shortcut', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 12; i++) {
      tracker.record('menu:alignLeft');
    }
    for (let i = 0; i < 3; i++) {
      tracker.record('shortcut:alignLeft');
    }

    const result = recommendShortcuts(tracker);
    const alignLeftRec = result.find((r) => r.actionId === 'menu:alignLeft');
    expect(alignLeftRec).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('recommends tool shortcut for tool action used 8 times', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 8; i++) {
      tracker.record('tool:rect');
    }

    const result = recommendShortcuts(tracker);
    const rectRec = result.find((r) => r.actionId === 'tool:rect');
    expect(rectRec).toBeDefined();
    expect(rectRec!.usageCount).toBe(8);
    expect(rectRec!.message).toContain('Rectangle tool');
    vi.restoreAllMocks();
  });

  it('respects maxResults parameter', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 8; i++) {
      tracker.record('tool:rect');
    }
    for (let i = 0; i < 10; i++) {
      tracker.record('menu:group');
    }

    const result = recommendShortcuts(tracker, 1);
    expect(result.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('returns empty when no menu/tool actions exceed threshold', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 3; i++) {
      tracker.record('menu:group');
    }

    const result = recommendShortcuts(tracker);
    expect(result).toEqual([]);
    vi.restoreAllMocks();
  });

  it('does not recommend non-menu/tool actions', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 10; i++) {
      tracker.record('setFill');
    }

    const result = recommendShortcuts(tracker);
    expect(result).toEqual([]);
    vi.restoreAllMocks();
  });

  it('returns empty for empty tracker', () => {
    const result = recommendShortcuts(tracker);
    expect(result).toEqual([]);
  });

  it('does not recommend when shortcut has no binding in SHORTCUT_DEFS', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 10; i++) {
      tracker.record('menu:unknownAction');
    }

    const result = recommendShortcuts(tracker);
    expect(result).toEqual([]);
    vi.restoreAllMocks();
  });

  it('is deterministic given same input', () => {
    const now = Date.now();
    let counter = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now + counter++ * 200);

    for (let i = 0; i < 8; i++) {
      tracker.record('tool:rect');
    }
    for (let i = 0; i < 10; i++) {
      tracker.record('menu:group');
    }

    const result1 = recommendShortcuts(tracker);
    const result2 = recommendShortcuts(tracker);
    expect(result1).toEqual(result2);
    vi.restoreAllMocks();
  });
});
