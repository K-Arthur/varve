/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionTracker } from './actionTracker';
import { getComplexityConfig, getComplexityLevel } from './progressiveComplexity';

describe('getComplexityLevel', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  it('classifies as beginner with fewer than 20 actions and no advanced features', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 15; i++) {
      tracker.record('tool:select');
      now += 1000;
    }
    expect(getComplexityLevel(tracker)).toBe('beginner');
    vi.restoreAllMocks();
  });

  it('classifies as intermediate with 20-100 actions and no advanced features', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 50; i++) {
      tracker.record('tool:select');
      now += 1000;
    }
    expect(getComplexityLevel(tracker)).toBe('intermediate');
    vi.restoreAllMocks();
  });

  it('classifies as advanced with >100 actions', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 120; i++) {
      tracker.record('tool:select');
      now += 1000;
    }
    expect(getComplexityLevel(tracker)).toBe('advanced');
    vi.restoreAllMocks();
  });

  it('classifies as intermediate with 1-2 advanced features even with few actions', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    tracker.record('tool:select');
    now += 1000;
    tracker.record('booleanUnion');
    now += 1000;
    tracker.record('group');
    now += 1000;
    expect(getComplexityLevel(tracker)).toBe('intermediate');
    vi.restoreAllMocks();
  });

  it('classifies as advanced with 3+ advanced features', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    tracker.record('booleanUnion');
    now += 1000;
    tracker.record('booleanSubtract');
    now += 1000;
    tracker.record('group');
    now += 1000;
    tracker.record('variables');
    now += 1000;
    expect(getComplexityLevel(tracker)).toBe('advanced');
    vi.restoreAllMocks();
  });

  it('returns deterministic result for same action sequence', () => {
    const makeTracker = (): ActionTracker => {
      const t = new ActionTracker();
      let mockTime = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);
      for (let i = 0; i < 25; i++) {
        t.record('tool:select');
        mockTime += 1000;
      }
      vi.restoreAllMocks();
      return t;
    };

    const t1 = makeTracker();
    const t2 = makeTracker();
    expect(getComplexityLevel(t1)).toBe(getComplexityLevel(t2));
  });

  it('returns beginner for empty tracker', () => {
    expect(getComplexityLevel(tracker)).toBe('beginner');
  });
});

describe('getComplexityConfig', () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new ActionTracker();
  });

  it('hides effects, blendModes, variables, prototype, stateMachines for beginner', () => {
    const config = getComplexityConfig(tracker);
    expect(config.level).toBe('beginner');
    expect(config.hiddenSections).toContain('effects');
    expect(config.hiddenSections).toContain('blendModes');
    expect(config.hiddenSections).toContain('variables');
    expect(config.hiddenSections).toContain('prototype');
    expect(config.hiddenSections).toContain('stateMachines');
  });

  it('only hides stateMachines for intermediate', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 50; i++) {
      tracker.record('tool:select');
      now += 1000;
    }
    const config = getComplexityConfig(tracker);
    expect(config.level).toBe('intermediate');
    expect(config.hiddenSections).toContain('stateMachines');
    expect(config.hiddenSections).not.toContain('effects');
    expect(config.hiddenSections).not.toContain('variables');
    vi.restoreAllMocks();
  });

  it('shows everything for advanced', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 120; i++) {
      tracker.record('tool:select');
      now += 1000;
    }
    const config = getComplexityConfig(tracker);
    expect(config.level).toBe('advanced');
    expect(config.hiddenSections).toHaveLength(0);
    expect(config.hiddenFeatures).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
