/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActionStats, classifyFromActionTracker, classifySkill } from './onboardingAdapter';

function makeStats(overrides: Partial<ActionStats> = {}): ActionStats {
  return {
    shortcutCount: 0,
    openedExistingFile: false,
    createdFrameWithChildren: false,
    avgActionTimeSec: 10,
    usedStyleControls: false,
    nodesCreated: 0,
    sessionTimeSec: 60,
    uniqueToolsUsed: 1,
    ...overrides,
  };
}

function makeTracker(actions: Array<{ actionId: string; timestamp: number }>) {
  const records = [...actions];
  return {
    getCount: (prefix: string, windowMs?: number) => {
      const cutoff = windowMs ? Date.now() - windowMs : 0;
      return records.filter((r) => r.actionId.startsWith(prefix) && r.timestamp >= cutoff).length;
    },
    getRecentActions: (windowMs: number) => {
      const cutoff = Date.now() - windowMs;
      return records.filter((r) => r.timestamp >= cutoff);
    },
    getTotalCount: () => records.length,
  };
}

describe('classifySkill', () => {
  it('classifies as advanced with shortcuts + fast actions', () => {
    const result = classifySkill(makeStats({ shortcutCount: 5, avgActionTimeSec: 1.5 }));
    expect(result.level).toBe('advanced');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('classifies as returning user who opened existing file', () => {
    const result = classifySkill(makeStats({ openedExistingFile: true, uniqueToolsUsed: 4 }));
    expect(result.level).toBe('intermediate');
  });

  it('classifies as intermediate when creating frame with children', () => {
    const result = classifySkill(
      makeStats({ createdFrameWithChildren: true, nodesCreated: 4, uniqueToolsUsed: 3 }),
    );
    expect(result.level).toBe('intermediate');
  });

  it('classifies as intermediate with moderate content creation', () => {
    const result = classifySkill(makeStats({ nodesCreated: 4, sessionTimeSec: 120 }));
    expect(result.level).toBe('intermediate');
  });

  it('classifies as intermediate when using color/typography controls with other signals', () => {
    const result = classifySkill(
      makeStats({ usedStyleControls: true, nodesCreated: 4, sessionTimeSec: 120 }),
    );
    expect(result.level).toBe('intermediate');
  });

  it('classifies as beginner (safety net) when no criteria match', () => {
    const result = classifySkill(makeStats({}));
    expect(result.level).toBe('beginner');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('includes reasons in classification result', () => {
    const result = classifySkill(makeStats({ shortcutCount: 1 }));
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe('classifyFromActionTracker', () => {
  it('returns beginner when not enough data', () => {
    const tracker = makeTracker([{ actionId: 'tool:select', timestamp: Date.now() }]);
    const result = classifyFromActionTracker(tracker);
    expect(result.level).toBe('beginner');
    expect(result.reasons).toContain('Not enough data yet');
  });

  it('classifies via shortcut count from tracker data', () => {
    const now = Date.now();
    const actions = [
      { actionId: 'tool:select', timestamp: now - 5000 },
      { actionId: 'shortcut:toolRect', timestamp: now - 4000 },
      { actionId: 'shortcut:toolSelect', timestamp: now - 3000 },
      { actionId: 'shortcut:group', timestamp: now - 2000 },
    ];
    const tracker = makeTracker(actions);
    const result = classifyFromActionTracker(tracker);
    expect(result.level).toBe('advanced');
  });

  it('classifies correctly from real action patterns', () => {
    const now = Date.now();
    const actions = [
      { actionId: 'tool:select', timestamp: now - 60000 },
      { actionId: 'tool:rect', timestamp: now - 55000 },
      { actionId: 'op:createNode', timestamp: now - 50000 },
      { actionId: 'tool:select', timestamp: now - 45000 },
      { actionId: 'op:createNode', timestamp: now - 40000 },
      { actionId: 'op:createNode', timestamp: now - 35000 },
      { actionId: 'menu:colorPicker', timestamp: now - 30000 },
      { actionId: 'tool:text', timestamp: now - 25000 },
    ];
    const tracker = makeTracker(actions);
    const result = classifyFromActionTracker(tracker);
    expect(result.level).toBe('intermediate');
  });
});
