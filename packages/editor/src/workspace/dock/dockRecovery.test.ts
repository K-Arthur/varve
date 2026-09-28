import { describe, expect, it } from 'vitest';
import {
  beginDockRestoreAttempt,
  markDockRestoreSucceeded,
  mergeDockRestoreState,
  sanitizeDockRestoreState,
  shouldUseDockRecoveryDefault,
} from './dockRecovery';
import { createCanvasNode, DOCK_LAYOUT_SCHEMA_VERSION } from './dockTypes';

const goodLayout = {
  schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION,
  windows: [
    {
      id: 'main',
      role: 'primary' as const,
      dockRoot: createCanvasNode(),
      floatingGroups: [],
    },
  ],
};

describe('dock recovery metadata', () => {
  it('offers the saved tree once, then selects a default after two failed launches', () => {
    const firstLaunch = beginDockRestoreAttempt(undefined, 'writer-a');
    expect(firstLaunch.failedAttempts).toBe(0);
    expect(shouldUseDockRecoveryDefault(firstLaunch)).toBe(false);

    const secondLaunch = beginDockRestoreAttempt(firstLaunch, 'writer-b');
    expect(secondLaunch.failedAttempts).toBe(1);
    expect(shouldUseDockRecoveryDefault(secondLaunch)).toBe(true);

    const thirdLaunch = beginDockRestoreAttempt(secondLaunch, 'writer-c');
    expect(thirdLaunch.failedAttempts).toBe(2);
  });

  it('promotes only a valid tree after a successful mount', () => {
    const pending = beginDockRestoreAttempt(undefined, 'writer-a');
    const promoted = markDockRestoreSucceeded(pending, goodLayout, 'writer-b');
    expect(promoted.pending).toBe(false);
    expect(promoted.failedAttempts).toBe(0);
    expect(promoted.lastKnownGood).toEqual(goodLayout);

    const invalid = markDockRestoreSucceeded(pending, { ...goodLayout, windows: [] }, 'writer-c');
    expect(invalid.pending).toBe(true);
    expect(invalid.lastKnownGood).toBeUndefined();
  });

  it('merges hydration by revision and uses writer identity for ties', () => {
    const older = beginDockRestoreAttempt(undefined, 'writer-a');
    const newer = { ...older, revision: older.revision + 1, writerId: 'writer-z' };
    expect(mergeDockRestoreState(older, newer)).toBe(newer);

    const concurrent = { ...older, writerId: 'writer-b' };
    expect(mergeDockRestoreState(older, concurrent)).toBe(concurrent);
    expect(mergeDockRestoreState(concurrent, older)).toBe(concurrent);
  });

  it('drops malformed counters but keeps validated recovery trees', () => {
    const state = beginDockRestoreAttempt(undefined, 'writer-a');
    expect(sanitizeDockRestoreState({ ...state, failedAttempts: 3 })).toBeUndefined();
    expect(sanitizeDockRestoreState({ ...state, lastKnownGood: goodLayout })).toEqual({
      ...state,
      lastKnownGood: goodLayout,
    });
    expect(sanitizeDockRestoreState({ ...state, lastKnownGood: { schemaVersion: 99 } })).toEqual(
      state,
    );
  });
});
