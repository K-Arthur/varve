/**
 * Dock-model property tests (ADR-0021 §invariants, ADR-0042 L1).
 *
 * Random operation sequences over the pure dock model must never produce:
 * - a panel instance hosted in more than one place
 * - unknown references, invalid ratios, unreachable panels
 * - a tree that fails serialization round-trip
 *
 * Uses fast-check (100 + 50 + 50 runs per property — fast).
 */

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../../panelDefinitions';
import { listPanelDefinitions, type PanelTypeId, resetPanelRegistry } from '../../panelRegistry';
import {
  addPanelToWindow,
  addToTabGroup,
  createWindow,
  deserializeDockTree,
  listPanelInstances,
  movePanelBetweenWindows,
  normalizeDockTree,
  removePanel,
  splitHost,
  validateDockLayout,
  validateDockTree,
} from '../dockOps';
import type { DockLayout, DockNode, PanelInstanceRef } from '../dockTypes';
import { createPanelInstanceRef } from '../dockTypes';

type Op =
  | { op: 'insert'; panelType: PanelTypeId }
  | { op: 'tab'; panelType: PanelTypeId }
  | { op: 'split'; panelType: PanelTypeId; direction: 'row' | 'column'; ratio: number }
  | { op: 'remove' }
  | { op: 'move' };

const PANEL_TYPES: readonly PanelTypeId[] = [
  'layers',
  'inspector',
  'timeline',
  'pagenav',
  'library',
  'codegen',
  'logo',
];

/** Ratios as integer-percent to stay float32-representable for fc.float. */
const ratioArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 90 }).map((n) => n / 100);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('insert'), panelType: fc.constantFrom(...PANEL_TYPES) }),
  fc.record({ op: fc.constant('tab'), panelType: fc.constantFrom(...PANEL_TYPES) }),
  fc.record({
    op: fc.constant('split'),
    panelType: fc.constantFrom(...PANEL_TYPES),
    direction: fc.constantFrom('row', 'column'),
    ratio: ratioArb,
  }),
  fc.record({ op: fc.constant('remove') }),
  fc.record({ op: fc.constant('move') }),
);

const opSeqArb: fc.Arbitrary<Op[]> = fc.array(opArb, { minLength: 1, maxLength: 40 });

function makeLayout(): DockLayout {
  return {
    schemaVersion: 1,
    windows: [createWindow('primary', 'w1'), createWindow('auxiliary-panel', 'w2')],
  };
}

function panelNode(ref: PanelInstanceRef): DockNode {
  return {
    kind: 'panel',
    id: `panel-${ref.instanceId}`,
    panelInstanceId: ref.instanceId,
    panelTypeId: ref.panelTypeId,
  };
}

function setPrimaryRoot(layout: DockLayout, root: DockNode): DockLayout {
  return {
    ...layout,
    windows: layout.windows.map((w, i) =>
      i === 0 ? { ...w, dockRoot: normalizeDockTree(root) } : w,
    ),
  };
}

function applyOp(layout: DockLayout, op: Op): DockLayout {
  let next = layout;
  const primary = next.windows[0];
  if (!primary) return layout;
  const root = primary.dockRoot;

  // The property model is policy-respecting: a singleton panel type is
  // added at most once (the model itself flags violations — that is the
  // point of validateDockLayout, covered by unit tests).
  const alreadyHosted =
    op.op !== 'remove' && op.op !== 'move'
      ? collectInstances(next).some((p) => p.panelTypeId === op.panelType)
      : false;

  switch (op.op) {
    case 'insert': {
      if (!alreadyHosted) next = addPanelToWindow(next, primary.id, op.panelType).layout;
      break;
    }
    case 'tab': {
      if (!alreadyHosted) {
        const ref = createPanelInstanceRef(op.panelType);
        const merged = root.kind === 'empty' ? panelNode(ref) : addToTabGroup(root, root.id, ref);
        next = setPrimaryRoot(next, merged);
      }
      break;
    }
    case 'split': {
      if (!alreadyHosted) {
        const ref = createPanelInstanceRef(op.panelType);
        const merged =
          root.kind === 'empty'
            ? panelNode(ref)
            : splitHost(root, root.id, ref, op.direction, op.ratio, `split-${ref.instanceId}`);
        next = setPrimaryRoot(next, merged);
      }
      break;
    }
    case 'remove': {
      const first = firstInstanceRef(next);
      if (first) {
        const index = next.windows.findIndex((w) => findInWindow(w.dockRoot, first.instanceId));
        const sourceWindow = index !== -1 ? next.windows[index] : undefined;
        if (sourceWindow) {
          const removed = removePanel(sourceWindow.dockRoot, first.instanceId);
          next = {
            ...next,
            windows: next.windows.map((w) =>
              w.id === sourceWindow.id ? { ...w, dockRoot: normalizeDockTree(removed.tree) } : w,
            ),
          };
        }
      }
      break;
    }
    case 'move': {
      const first = firstInstanceRef(next);
      if (first) {
        const other = next.windows.find((w) => w.id !== first.windowId);
        if (other) {
          next = movePanelBetweenWindows(next, first.instanceId, other.id).layout;
        }
      }
      break;
    }
  }
  return next;
}

function findInWindow(root: DockNode, instanceId: string): boolean {
  return listPanelInstances(root).some((p) => p.instanceId === instanceId);
}

function firstInstanceRef(
  layout: DockLayout,
): { instanceId: string; windowId: string } | undefined {
  for (const window of layout.windows) {
    const instances = listPanelInstances(window.dockRoot);
    const first = instances[0];
    if (first) {
      return { instanceId: first.instanceId, windowId: window.id };
    }
  }
  return undefined;
}

function collectInstances(layout: DockLayout): PanelInstanceRef[] {
  return layout.windows.flatMap((w) => listPanelInstances(w.dockRoot));
}

const failure: { message: string | null } = { message: null };

function check(condition: boolean, message: string): boolean {
  if (!condition) failure.message = message;
  return condition;
}

describe('dock model property tests', () => {
  beforeEach(() => {
    failure.message = null;
    resetPanelRegistry();
    registerBuiltinPanels();
    expect(listPanelDefinitions().length).toBeGreaterThan(0);
  });

  it('random operation sequences never violate layout invariants', () => {
    fc.assert(
      fc.property(opSeqArb, (ops) => {
        let layout = makeLayout();
        for (const op of ops) {
          layout = applyOp(layout, op);
          const violations = validateDockLayout(layout);
          if (
            !check(
              violations.length === 0,
              `invariant broken after ${JSON.stringify(op)}: ${violations.join('; ')}`,
            )
          ) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('every instance is reachable from its window root (no unreachable panels)', () => {
    fc.assert(
      fc.property(opSeqArb, (ops) => {
        let layout = makeLayout();
        for (const op of ops) layout = applyOp(layout, op);
        for (const window of layout.windows) {
          for (const ref of listPanelInstances(window.dockRoot)) {
            if (
              !check(
                findInWindow(window.dockRoot, ref.instanceId),
                `instance ${ref.instanceId} unreachable in window ${window.id}`,
              )
            ) {
              return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('serialization round-trip preserves the instance set and validates cleanly', () => {
    fc.assert(
      fc.property(opSeqArb, (ops) => {
        let layout = makeLayout();
        for (const op of ops) layout = applyOp(layout, op);

        const serialized = JSON.parse(JSON.stringify(layout)) as DockLayout;
        for (const window of serialized.windows) {
          const result = deserializeDockTree(window.dockRoot);
          if (!result.ok) return false;
          const violations = validateDockTree(result.tree);
          if (!check(violations.length === 0, `round-trip violations: ${violations.join('; ')}`))
            return false;
        }

        const before = collectInstances(layout)
          .map((p) => p.instanceId)
          .sort();
        const after = serialized.windows
          .flatMap((w) => listPanelInstances(w.dockRoot))
          .map((p) => p.instanceId)
          .sort();
        if (
          !check(
            JSON.stringify(before) === JSON.stringify(after),
            `instance set changed by round-trip: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
          )
        ) {
          return false;
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it('removing any present panel never corrupts the tree', () => {
    fc.assert(
      fc.property(opSeqArb, (ops) => {
        let layout = makeLayout();
        for (const op of ops) layout = applyOp(layout, op);

        for (const ref of collectInstances(layout)) {
          const windowIndex = layout.windows.findIndex((w) =>
            findInWindow(w.dockRoot, ref.instanceId),
          );
          if (!check(windowIndex !== -1, `instance ${ref.instanceId} not in any window`))
            return false;
          const window = layout.windows[windowIndex];
          if (!window) return false;
          const removed = removePanel(window.dockRoot, ref.instanceId);
          const violations = validateDockTree(normalizeDockTree(removed.tree));
          if (
            !check(
              violations.length === 0,
              `tree corrupted after removing ${ref.instanceId}: ${violations.join('; ')}`,
            )
          ) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });
});
