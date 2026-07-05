/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ActionTracker, getActionTracker } from './actionTracker';

describe('ActionTracker', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  it('records an action and increments count', () => {
    tracker.record('tool:rect');
    expect(tracker.getCount('tool:rect')).toBe(1);
  });

  it('records same action 3 times and count is 3', () => {
    const base = Date.now();
    const mockDate = vi.spyOn(Date, 'now');
    let counter = 0;
    mockDate.mockImplementation(() => base + counter++ * 200);
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    expect(tracker.getCount('tool:rect')).toBe(3);
    mockDate.mockRestore();
  });

  it('records 2 different actions and frequency map has both', () => {
    tracker.record('tool:rect');
    tracker.record('tool:select');
    const map = tracker.getFrequencyMap();
    expect(map.get('tool:rect')).toBe(1);
    expect(map.get('tool:select')).toBe(1);
  });

  it('prunes actions older than 30 days on load', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const recent = Date.now() - 1000;
    const data = JSON.stringify([
      { actionId: 'tool:rect', timestamp: old },
      { actionId: 'tool:select', timestamp: recent },
    ]);
    localStorage.setItem('strata:actions', data);
    const t = new ActionTracker();
    expect(t.getCount('tool:rect')).toBe(0);
    expect(t.getCount('tool:select')).toBe(1);
  });

  it('toJSON / fromJSON round-trip preserves data', () => {
    tracker.record('tool:rect');
    tracker.record('tool:select');
    const json = tracker.toJSON();
    const t2 = new ActionTracker();
    t2.fromJSON(json);
    expect(t2.getCount('tool:rect')).toBe(1);
    expect(t2.getCount('tool:select')).toBe(1);
  });

  it('debounces rapid same-action calls within 100ms', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    tracker.record('tool:rect');
    expect(tracker.getCount('tool:rect')).toBe(1);
    vi.restoreAllMocks();
  });

  it('getRecentActions returns actions within window', () => {
    tracker.record('tool:rect');
    const recent = tracker.getRecentActions(60_000);
    expect(recent.length).toBe(1);
    expect(recent[0].actionId).toBe('tool:rect');
  });

  it('clear removes all records', () => {
    tracker.record('tool:rect');
    tracker.record('tool:select');
    tracker.clear();
    expect(tracker.getTotalCount()).toBe(0);
  });

  it('getActionTracker returns singleton', () => {
    const a = getActionTracker();
    const b = getActionTracker();
    expect(a).toBe(b);
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('strata:actions', 'not-json');
    const t = new ActionTracker();
    expect(t.getTotalCount()).toBe(0);
  });
});
