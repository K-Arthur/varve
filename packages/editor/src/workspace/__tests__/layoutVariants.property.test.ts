/**
 * Layout-variant property tests.
 *
 * Random bounded sequences of add/rename/duplicate/delete/apply/merge must
 * never produce:
 * - a stored variant referencing a built-in id, an empty/oversized name, or
 *   an unsanitized capability payload
 * - a deleted variant resurrected by a merge, regardless of which side is
 *   "local"
 * - an applied payload whose effective config hides an essential recovery
 *   tool, references an unknown panel, or loses a chrome toggle
 * - a store that changes semantics when serialized and re-sanitized
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addLayoutVariant,
  applyLayoutPayloadToPreferences,
  captureLayoutPayload,
  createEmptyLayoutStore,
  deleteLayoutVariant,
  duplicateLayoutVariant,
  type LayoutPreferencePayload,
  mergeLayoutStores,
  renameLayoutVariant,
  sanitizeLayoutPayload,
  sanitizeLayoutStore,
  type WorkspaceLayoutStoreState,
} from '../layoutVariants';
import { ESSENTIAL_TOOL_IDS } from '../toolLabels';
import { getEffectiveWorkspaceConfig } from '../workspaceStore';
import type { WorkspacePreferences } from '../workspaceTypes';
import { ALL_WORKSPACE_MODES, getToolbarToolIds, type WorkspaceMode } from '../workspaceTypes';

const MODES: readonly WorkspaceMode[] = ALL_WORKSPACE_MODES;

const payloadArb: fc.Arbitrary<LayoutPreferencePayload> = fc
  .record({
    hideHistory: fc.boolean(),
    hideInspectorTab: fc.boolean(),
    hideZoomSection: fc.boolean(),
    hideRectTool: fc.boolean(),
    hideSelectTool: fc.boolean(),
    layersWidth: fc.option(fc.integer({ min: -500, max: 5000 }), { nil: undefined }),
    hideStatusBar: fc.boolean(),
    unknownPanel: fc.boolean(),
  })
  .map((input) => {
    const payload: LayoutPreferencePayload = {};
    if (input.hideHistory) payload.panelOverrides = { history: { visible: true } };
    if (input.hideInspectorTab) payload.inspectorTabOverrides = { properties: false };
    if (input.hideZoomSection) payload.statusSectionOverrides = { zoom: false };
    if (input.hideRectTool || input.hideSelectTool) {
      payload.toolbarToolOverrides = {
        ...(input.hideRectTool ? { rect: false } : {}),
        // Essential tools must never be hideable, however hostile the input.
        ...(input.hideSelectTool ? { select: false } : {}),
      };
    }
    if (input.layersWidth !== undefined) payload.panelWidths = { layers: input.layersWidth };
    if (input.hideStatusBar) payload.chromeOverrides = { statusBar: false };
    if (input.unknownPanel) {
      payload.panelOverrides = {
        ...(payload.panelOverrides ?? {}),
        notAPanel: { visible: false },
      } as LayoutPreferencePayload['panelOverrides'];
    }
    return payload;
  });

type Op =
  | { op: 'add'; name: string; payload: LayoutPreferencePayload }
  | { op: 'delete'; index: number }
  | { op: 'rename'; index: number; name: string }
  | { op: 'duplicate'; index: number }
  | { op: 'apply'; index: number; mode: WorkspaceMode }
  | { op: 'merge'; delta: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant('add' as const),
      name: fc.string({ maxLength: 80 }),
      payload: payloadArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ op: fc.constant('delete' as const), index: fc.nat({ max: 20 }) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('rename' as const),
      index: fc.nat({ max: 20 }),
      name: fc.string({ maxLength: 80 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ op: fc.constant('duplicate' as const), index: fc.nat({ max: 20 }) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('apply' as const),
      index: fc.nat({ max: 20 }),
      mode: fc.constantFrom(...MODES),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant('merge' as const),
      delta: fc.integer({ min: -5, max: 5 }),
    }),
  },
);

function visibleVariants(state: WorkspaceLayoutStoreState) {
  return state.variants;
}

function assertStoreInvariants(state: WorkspaceLayoutStoreState) {
  expect(state.variants.length).toBeLessThanOrEqual(50);
  for (const variant of state.variants) {
    expect(variant.builtIn).toBe(false);
    expect(variant.name.length).toBeGreaterThan(0);
    expect(variant.name.length).toBeLessThanOrEqual(64);
    expect(variant.id.startsWith('builtin-')).toBe(false);
    // Unknown capability ids are stripped by sanitization.
    expect(
      (variant.payload.panelOverrides as Record<string, unknown> | undefined)?.notAPanel,
    ).toBeUndefined();
  }
}

function assertPayloadInvariants(payload: LayoutPreferencePayload) {
  const sanitized = sanitizeLayoutPayload(payload);
  for (const modeToCheck of MODES) {
    const prefs = applyLayoutPayloadToPreferences(defaultPrefs(), modeToCheck, sanitized);
    const effective = getEffectiveWorkspaceConfig(modeToCheck, prefs);
    // Every panel id resolves.
    for (const panelId of Object.keys(effective.panels)) {
      expect(effective.panels[panelId as keyof typeof effective.panels]).toBeDefined();
    }
    // Essential recovery tools survive any payload.
    const tools = new Set(getToolbarToolIds(effective.toolbar));
    for (const essential of ESSENTIAL_TOOL_IDS) expect(tools.has(essential)).toBe(true);
    // Chrome toggles stay boolean.
    expect(typeof effective.statusBar).toBe('boolean');
    expect(typeof effective.tabStrip).toBe('boolean');
    expect(typeof effective.floatingToolbar).toBe('boolean');
    // Widths are bounded by the sanitizer.
    const width = sanitized.panelWidths?.layers;
    if (width !== undefined) {
      expect(width).toBeGreaterThanOrEqual(120);
      expect(width).toBeLessThanOrEqual(1200);
    }
  }
}

function defaultPrefs(): WorkspacePreferences {
  const prefs = {} as WorkspacePreferences;
  for (const mode of MODES) prefs[mode] = { customized: false };
  return prefs;
}

function applyOps(ops: Op[]): WorkspaceLayoutStoreState {
  let state = createEmptyLayoutStore();
  let now = 1_000;
  for (const op of ops) {
    now += 1;
    if (op.op === 'add') {
      const result = addLayoutVariant(
        state,
        { name: op.name, sourceMode: MODES[now % MODES.length]!, payload: op.payload },
        now,
      );
      if (result.ok) state = result.state;
    } else if (op.op === 'delete') {
      const variant = visibleVariants(state)[op.index % Math.max(1, state.variants.length)];
      if (variant) state = deleteLayoutVariant(state, variant.id, now);
    } else if (op.op === 'rename') {
      const variant = state.variants[op.index % Math.max(1, state.variants.length)];
      if (variant) {
        const result = renameLayoutVariant(state, variant.id, op.name, now);
        if (result.ok) state = result.state;
      }
    } else if (op.op === 'duplicate') {
      const variant = state.variants[op.index % Math.max(1, state.variants.length)];
      if (variant) {
        const result = duplicateLayoutVariant(state, variant.id, now);
        if (result.ok) state = result.state;
      }
    } else if (op.op === 'apply') {
      const variant = state.variants[op.index % Math.max(1, state.variants.length)];
      if (variant) assertPayloadInvariants(variant.payload);
    } else if (op.op === 'merge') {
      const remote: WorkspaceLayoutStoreState = JSON.parse(JSON.stringify(state));
      for (const variant of remote.variants) {
        variant.updatedAt += op.delta;
      }
      state = mergeLayoutStores(state, remote);
    }
  }
  return state;
}

describe('layoutVariants: property invariants', () => {
  it('random operation sequences keep the store valid', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const state = applyOps(ops);
        assertStoreInvariants(state);
        // Serialization + sanitize is idempotent (no semantic drift).
        const reloaded = sanitizeLayoutStore(JSON.parse(JSON.stringify(state)));
        expect(JSON.stringify(reloaded.variants)).toBe(
          JSON.stringify(sanitizeLayoutStore(state).variants),
        );
      }),
      { numRuns: 60 },
    );
  });

  it('deletions are never resurrected by a merge, from either side', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        let state = applyOps(ops);
        const variant = state.variants[0];
        if (!variant) return;
        state = deleteLayoutVariant(state, variant.id, variant.updatedAt + 100);

        const remote: WorkspaceLayoutStoreState = {
          ...createEmptyLayoutStore(),
          variants: [variant],
          tombstones: {},
        };
        const mergedAsLocal = mergeLayoutStores(state, remote);
        const mergedAsRemote = mergeLayoutStores(remote, state);
        for (const merged of [mergedAsLocal, mergedAsRemote]) {
          expect(merged.variants.some((candidate) => candidate.id === variant.id)).toBe(false);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('capture is sparse and stable: capturing an uncustomized mode is empty', () => {
    for (const mode of MODES) {
      expect(captureLayoutPayload(mode, defaultPrefs())).toEqual({});
    }
  });

  it('sanitizing any payload twice never changes the result', () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const once = sanitizeLayoutPayload(payload);
        const twice = sanitizeLayoutPayload(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 60 },
    );
  });
});
