/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(recent[0]?.actionId).toBe('tool:rect');
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

  it('records with context field', () => {
    tracker.record('tool:select', { kind: 'frame', count: '3' });
    expect(tracker.getCount('tool:select')).toBe(1);
  });

  it('getActionSequence returns ordered action IDs within window', () => {
    const base = Date.now();
    let mockNow = base;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    tracker.record('tool:select');
    mockNow += 200;
    tracker.record('tool:rect');
    mockNow += 200;
    tracker.record('menu:group');
    const seq = tracker.getActionSequence(60_000);
    expect(seq).toEqual(['tool:select', 'tool:rect', 'menu:group']);
    vi.restoreAllMocks();
  });

  it('getCoOccurrenceMap finds co-occurring action pairs', () => {
    const base = Date.now();
    let mockNow = base;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    tracker.record('tool:select');
    mockNow += 100;
    tracker.record('tool:rect');
    mockNow += 100;
    tracker.record('setFill');
    mockNow += 100;
    tracker.record('tool:select');
    mockNow += 100;
    tracker.record('tool:rect');
    const coMap = tracker.getCoOccurrenceMap(60_000);
    expect(coMap.get('setFill::tool:select')).toBe(1);
    expect(coMap.get('tool:rect::tool:select')).toBeGreaterThanOrEqual(2);
    vi.restoreAllMocks();
  });

  it('context is preserved through toJSON/fromJSON', () => {
    tracker.record('tool:select', { mode: 'design' });
    const json = tracker.toJSON();
    const t2 = new ActionTracker();
    t2.fromJSON(json);
    const recent = t2.getRecentActions(60_000);
    expect(recent[0]?.context).toEqual({ mode: 'design' });
  });
});
