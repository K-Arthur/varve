/**
 * Recovery Manager tests (M11).
 *
 * Pure unit tests for crash tracking, safe mode detection, orphaned
 * panel recovery, and safe-mode layout generation. No React, no Tauri.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { NativeWorkspaceLayout } from '../dockTypes';
import { createPanelDockNode } from '../dockTypes';
import {
  cleanOrphanedPanels,
  createCrashHistory,
  createSafeModeLayout,
  findMissingPanels,
  findOrphanedPanels,
  markCleanShutdown,
  recordCrash,
  repairLayout,
  safeModeReason,
  shouldActivateSafeMode,
} from '../recoveryManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayout(overrides: Partial<NativeWorkspaceLayout> = {}): NativeWorkspaceLayout {
  return {
    schemaVersion: 1,
    id: `layout-${Date.now().toString(36)}`,
    name: 'Test Layout',
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: createPanelDockNode('pi-1'),
        state: 'normal',
      },
    ],
    panelInstances: [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Crash tracking
// ---------------------------------------------------------------------------

describe('recoveryManager: crash tracking', () => {
  let history: ReturnType<typeof createCrashHistory>;

  beforeEach(() => {
    history = createCrashHistory();
  });

  it('starts with zero crashes', () => {
    expect(history.crashes).toHaveLength(0);
    expect(history.consecutiveCrashes).toBe(0);
    expect(history.lastCleanShutdown).toBeNull();
  });

  it('records a crash', () => {
    const next = recordCrash(history, {
      timestamp: Date.now(),
      openWindows: ['main', 'aux-1'],
      activePanels: ['pi-1'],
    });
    expect(next.crashes).toHaveLength(1);
    expect(next.consecutiveCrashes).toBe(1);
  });

  it('increments consecutive crashes', () => {
    let next = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    next = recordCrash(next, { timestamp: 2, openWindows: [], activePanels: [] });
    expect(next.consecutiveCrashes).toBe(2);
  });

  it('resets consecutive crashes on clean shutdown', () => {
    let next = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    next = recordCrash(next, { timestamp: 2, openWindows: [], activePanels: [] });
    next = markCleanShutdown(next);
    expect(next.consecutiveCrashes).toBe(0);
    expect(next.lastCleanShutdown).toBeGreaterThan(0);
  });

  it('records error message', () => {
    const next = recordCrash(history, {
      timestamp: Date.now(),
      openWindows: [],
      activePanels: [],
      error: 'OOM in renderer',
    });
    expect(next.crashes[0].error).toBe('OOM in renderer');
  });
});

// ---------------------------------------------------------------------------
// Safe mode detection
// ---------------------------------------------------------------------------

describe('recoveryManager: safe mode detection', () => {
  it('does not activate safe mode after 1 crash', () => {
    const history = recordCrash(createCrashHistory(), {
      timestamp: Date.now(),
      openWindows: [],
      activePanels: [],
    });
    expect(shouldActivateSafeMode(history)).toBe(false);
  });

  it('activates safe mode after 2 consecutive crashes', () => {
    let history = createCrashHistory();
    history = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    history = recordCrash(history, { timestamp: 2, openWindows: [], activePanels: [] });
    expect(shouldActivateSafeMode(history)).toBe(true);
  });

  it('does not activate safe mode after crash + clean shutdown + crash', () => {
    let history = createCrashHistory();
    history = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    history = markCleanShutdown(history);
    history = recordCrash(history, { timestamp: 2, openWindows: [], activePanels: [] });
    expect(shouldActivateSafeMode(history)).toBe(false);
  });

  it('provides a reason for 2 consecutive crashes', () => {
    let history = createCrashHistory();
    history = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    history = recordCrash(history, { timestamp: 2, openWindows: [], activePanels: [] });
    const reason = safeModeReason(history);
    expect(reason).toContain('Multiple consecutive crashes');
  });

  it('provides a more aggressive reason for 3+ crashes', () => {
    let history = createCrashHistory();
    history = recordCrash(history, { timestamp: 1, openWindows: [], activePanels: [] });
    history = recordCrash(history, { timestamp: 2, openWindows: [], activePanels: [] });
    history = recordCrash(history, { timestamp: 3, openWindows: [], activePanels: [] });
    const reason = safeModeReason(history);
    expect(reason).toContain('3 consecutive crashes');
  });
});

// ---------------------------------------------------------------------------
// Orphaned panel detection
// ---------------------------------------------------------------------------

describe('recoveryManager: orphaned panel detection', () => {
  it('finds panels not referenced by any window', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-orphan', panelTypeId: 'inspector' as any, hostNodeId: 'h-orphan' },
      ],
    });

    const orphaned = findOrphanedPanels(layout);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].panelInstanceId).toBe('pi-orphan');
  });

  it('returns empty when all panels are referenced', () => {
    const layout = makeLayout();
    expect(findOrphanedPanels(layout)).toHaveLength(0);
  });

  it('finds missing panels (referenced but not in panelInstances)', () => {
    const layout = makeLayout({
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: createPanelDockNode('pi-missing'),
          state: 'normal',
        },
      ],
      panelInstances: [],
    });

    const missing = findMissingPanels(layout);
    expect(missing).toHaveLength(1);
    expect(missing[0].panelInstanceId).toBe('pi-missing');
    expect(missing[0].windowId).toBe('main');
  });

  it('returns empty when no panels are missing', () => {
    const layout = makeLayout();
    expect(findMissingPanels(layout)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Clean orphaned panels
// ---------------------------------------------------------------------------

describe('recoveryManager: cleanOrphanedPanels', () => {
  it('removes orphaned panel instances', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-orphan', panelTypeId: 'inspector' as any, hostNodeId: 'h-orphan' },
      ],
    });

    const cleaned = cleanOrphanedPanels(layout);
    expect(cleaned.panelInstances).toHaveLength(1);
    expect(cleaned.panelInstances[0].id).toBe('pi-1');
  });

  it('preserves all panels when none are orphaned', () => {
    const layout = makeLayout();
    const cleaned = cleanOrphanedPanels(layout);
    expect(cleaned.panelInstances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Safe mode layout
// ---------------------------------------------------------------------------

describe('recoveryManager: createSafeModeLayout', () => {
  it('creates a minimal layout with layers and inspector', () => {
    const layout = createSafeModeLayout();
    expect(layout.name).toBe('Safe Mode');
    expect(layout.windows).toHaveLength(1);
    expect(layout.windows[0].role).toBe('primary');
    expect(layout.panelInstances.length).toBeGreaterThanOrEqual(2);

    const types = layout.panelInstances.map((p) => p.panelTypeId);
    expect(types).toContain('layers');
    expect(types).toContain('inspector');
  });

  it('dock root is a split', () => {
    const layout = createSafeModeLayout();
    expect(layout.windows[0].dockRoot.kind).toBe('split');
  });

  it('carries forward safe panel types from previous layout', () => {
    const previous = makeLayout({
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-2', panelTypeId: 'timeline' as any, hostNodeId: 'h-2' },
        { id: 'pi-3', panelTypeId: 'library' as any, hostNodeId: 'h-3' },
      ],
    });

    const layout = createSafeModeLayout(previous);
    const types = layout.panelInstances.map((p) => p.panelTypeId);
    expect(types).toContain('layers');
    expect(types).toContain('inspector');
    expect(types).toContain('timeline');
    expect(types).toContain('library');
  });

  it('does not carry forward unsafe panel types', () => {
    const previous = makeLayout({
      panelInstances: [{ id: 'pi-1', panelTypeId: 'codegen' as any, hostNodeId: 'h-1' }],
    });

    const layout = createSafeModeLayout(previous);
    const types = layout.panelInstances.map((p) => p.panelTypeId);
    expect(types).not.toContain('codegen');
  });
});

// ---------------------------------------------------------------------------
// Layout repair
// ---------------------------------------------------------------------------

describe('recoveryManager: repairLayout', () => {
  it('removes orphaned panel instances', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-orphan', panelTypeId: 'inspector' as any, hostNodeId: 'h-orphan' },
      ],
    });

    const repaired = repairLayout(layout);
    expect(repaired.panelInstances).toHaveLength(1);
  });

  it('replaces missing panel refs with empty nodes', () => {
    const layout = makeLayout({
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: createPanelDockNode('pi-missing'),
          state: 'normal',
        },
      ],
      panelInstances: [],
    });

    const repaired = repairLayout(layout);
    expect(repaired.windows[0].dockRoot.kind).toBe('empty');
  });

  it('creates a default window when all windows are removed', () => {
    const layout = makeLayout({
      windows: [],
      panelInstances: [],
    });

    const repaired = repairLayout(layout);
    expect(repaired.windows).toHaveLength(1);
    expect(repaired.windows[0].id).toBe('main');
  });

  it('handles layout with no windows and no panels', () => {
    const layout = makeLayout({ windows: [], panelInstances: [] });
    const repaired = repairLayout(layout);
    expect(repaired.windows).toHaveLength(1);
    expect(repaired.windows[0].dockRoot.kind).toBe('empty');
  });

  it('preserves healthy windows', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
      ],
      panelInstances: [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }],
    });

    const repaired = repairLayout(layout);
    expect(repaired.windows).toHaveLength(1);
    expect(repaired.windows[0].dockRoot.kind).toBe('panel');
  });
});
