/**
 * Panel registry tests (ADR-0019).
 *
 * The registry is the single source of truth for panel capabilities. These
 * tests pin:
 * - registration and validation rules (invariants)
 * - the M2 contract: every built-in panel is registered, none detachable
 * - detachable => lifecycle + codec enforcement
 * - canvas/renderer-dependent panels cannot host in auxiliary windows
 * - registry-derived commands
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_PANEL_TYPES, registerBuiltinPanels } from '../panelDefinitions';
import {
  assertPanelInvariants,
  DEFAULT_PANEL_LOCAL_STATE_BYTES,
  type DetachablePanelLifecycle,
  getPanelCommandIds,
  getPanelDefinition,
  isPanelCanvasDependent,
  isPanelDetachable,
  listDetachablePanels,
  listPanelDefinitions,
  type PanelDefinition,
  type PanelLocalStateCodec,
  registerPanel,
  resetPanelRegistry,
  tryGetPanelDefinition,
  validatePanelDefinition,
} from '../panelRegistry';
import type { PanelId } from '../workspaceTypes';

function detachableDefinition(overrides: Partial<PanelDefinition> = {}): PanelDefinition {
  const lifecycle: DetachablePanelLifecycle = {
    prepareForTransfer: async () => ({
      schemaVersion: 1,
      panelTypeId: 'layers',
      state: {},
      byteSize: 0,
    }),
    restoreFromTransfer: async () => {},
  };
  const localStateCodec: PanelLocalStateCodec = {
    maxBytes: DEFAULT_PANEL_LOCAL_STATE_BYTES,
    encode: () => null,
    decode: () => null,
  };
  return {
    id: 'layers',
    title: 'Layers',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: true,
    dockable: true,
    minimumSize: { width: 180, height: 160 },
    loadPolicy: 'eager',
    inactivePolicy: 'keep-mounted',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    lifecycle,
    localStateCodec,
    a11yLabels: {
      detach: 'Detach Layers panel',
      reattach: 'Reattach Layers panel',
      moveTo: 'Move Layers panel to another window',
      close: 'Close Layers panel',
    },
    ...overrides,
  };
}

describe('panel registry: built-in registration', () => {
  beforeEach(() => {
    resetPanelRegistry();
  });

  it('registers every built-in panel with the PanelId set', () => {
    registerBuiltinPanels();
    expect(listPanelDefinitions()).toHaveLength(8);
    expect(assertPanelInvariants(ALL_PANEL_TYPES)).toEqual([]);
    for (const id of ALL_PANEL_TYPES) {
      expect(getPanelDefinition(id).id).toBe(id);
    }
  });

  it('keeps the registered set identical to the PanelId union (no drift)', () => {
    registerBuiltinPanels();
    const union: PanelId[] = [
      'layers',
      'inspector',
      'timeline',
      'pagenav',
      'library',
      'codegen',
      'logo',
      'history',
    ];
    const registered = listPanelDefinitions()
      .map((d) => d.id)
      .sort();
    expect([...union].sort()).toEqual(registered);
  });

  it('M2 contract: no built-in panel is detachable yet', () => {
    registerBuiltinPanels();
    expect(listDetachablePanels()).toEqual([]);
    for (const id of ALL_PANEL_TYPES) {
      expect(isPanelDetachable(id)).toBe(false);
    }
  });

  it('throws on duplicate registration', () => {
    registerBuiltinPanels();
    const dup = getPanelDefinition('layers');
    expect(() => registerPanel(dup)).toThrow(/already registered/);
  });

  it('throws on invalid definitions at registration time', () => {
    expect(() =>
      registerPanel(detachableDefinition({ detachable: true, lifecycle: undefined })),
    ).toThrow(/lifecycle/);
  });
});

describe('panel registry: invariants', () => {
  beforeEach(() => {
    resetPanelRegistry();
  });

  it('requires positive finite minimum sizes', () => {
    expect(
      validatePanelDefinition(detachableDefinition({ minimumSize: { width: 0, height: 160 } })),
    ).toContain('minimumSize.width must be a positive finite number');
    expect(
      validatePanelDefinition(
        detachableDefinition({ minimumSize: { width: Number.NaN, height: 160 } }),
      ),
    ).toContain('minimumSize.width must be a positive finite number');
  });

  it('requires allowedHosts to be non-empty', () => {
    expect(validatePanelDefinition(detachableDefinition({ allowedHosts: [] }))).toContain(
      'allowedHosts must be non-empty',
    );
  });

  it('detachable requires dockable + lifecycle + codec', () => {
    const withoutDockable = validatePanelDefinition(detachableDefinition({ dockable: false }));
    expect(withoutDockable).toContain('detachable panels must be dockable');

    const withoutLifecycle = validatePanelDefinition(
      detachableDefinition({ lifecycle: undefined }),
    );
    expect(withoutLifecycle).toContain('detachable panels must implement the lifecycle contract');

    const withoutCodec = validatePanelDefinition(
      detachableDefinition({ localStateCodec: undefined }),
    );
    expect(withoutCodec).toContain('detachable panels must provide a local-state codec');

    const partialLifecycle = detachableDefinition({
      lifecycle: {
        prepareForTransfer: async () => ({
          schemaVersion: 1,
          panelTypeId: 'layers' as const,
          state: {},
          byteSize: 0,
        }),
      },
    });
    expect(validatePanelDefinition(partialLifecycle)).toContain(
      'detachable lifecycle must implement prepareForTransfer and restoreFromTransfer',
    );
  });

  it('instance policy and multi-instance capability must agree', () => {
    const bad = detachableDefinition({
      instancePolicy: 'multiple',
      capabilities: {
        requiresCanvas: false,
        requiresRenderer: false,
        requiresModels: false,
        supportsMultipleInstances: false,
        supportsDocumentPinning: false,
      },
    });
    expect(validatePanelDefinition(bad)).toContain(
      "instancePolicy 'multiple' requires capabilities.supportsMultipleInstances",
    );

    const contradictory = detachableDefinition({
      instancePolicy: 'singleton',
      capabilities: {
        requiresCanvas: false,
        requiresRenderer: false,
        requiresModels: false,
        supportsMultipleInstances: true,
        supportsDocumentPinning: false,
      },
    });
    expect(validatePanelDefinition(contradictory)).toContain(
      'a non-multiple panel cannot claim supportsMultipleInstances',
    );
  });

  it('canvas/renderer-dependent panels cannot host in auxiliary windows', () => {
    const canvasPanel = detachableDefinition({
      id: 'layers',
      capabilities: {
        requiresCanvas: true,
        requiresRenderer: false,
        requiresModels: false,
        supportsMultipleInstances: false,
        supportsDocumentPinning: false,
      },
    });
    expect(validatePanelDefinition(canvasPanel)).toContain(
      'canvas-dependent panels cannot host in auxiliary windows (ADR-0037)',
    );

    const rendererPanel = detachableDefinition({
      capabilities: {
        requiresCanvas: false,
        requiresRenderer: true,
        requiresModels: false,
        supportsMultipleInstances: false,
        supportsDocumentPinning: false,
      },
    });
    expect(validatePanelDefinition(rendererPanel)).toContain(
      'renderer-dependent panels cannot host in auxiliary windows (ADR-0037)',
    );
  });

  it('flags registered panels outside the canonical set', () => {
    registerBuiltinPanels();
    expect(assertPanelInvariants(ALL_PANEL_TYPES)).toEqual([]);
    resetPanelRegistry();
    // Register a panel with an id outside the PanelId union — the
    // invariant check must catch the drift.
    registerPanel(detachableDefinition({ id: 'extra-panel' as PanelId }));
    expect(assertPanelInvariants(ALL_PANEL_TYPES)).not.toEqual([]);
  });

  it('reports missing panels from the required set', () => {
    registerBuiltinPanels();
    const missing = assertPanelInvariants(['layers', 'inspector', 'unknown-panel' as PanelId]);
    expect(missing.some((v) => v.includes("'unknown-panel'"))).toBe(true);
  });
});

describe('panel registry: queries and derived commands', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('tryGetPanelDefinition returns undefined for unknown ids', () => {
    expect(tryGetPanelDefinition('nope' as PanelId)).toBeUndefined();
    expect(() => getPanelDefinition('nope' as PanelId)).toThrow(/unknown panel type/);
  });

  it('isPanelCanvasDependent is false for all built-ins (M2)', () => {
    for (const id of ALL_PANEL_TYPES) {
      expect(isPanelCanvasDependent(id)).toBe(false);
    }
  });

  it('non-detachable panels expose no detach/move commands', () => {
    for (const id of ALL_PANEL_TYPES) {
      const commands = getPanelCommandIds(id);
      expect(commands.detach).toBeUndefined();
      expect(commands.moveTo).toBeUndefined();
    }
  });

  it('detachable panels derive detach/reattach/move commands from the registry', () => {
    resetPanelRegistry();
    registerPanel(detachableDefinition({ id: 'layers' }));
    const commands = getPanelCommandIds('layers');
    expect(commands.detach).toBe('panel.layers.detach');
    expect(commands.moveTo).toBe('panel.layers.moveTo');
    expect(commands.reattach).toBe('panel.layers.reattach');
  });

  it('honors custom command ids from the definition', () => {
    resetPanelRegistry();
    registerPanel(detachableDefinition({ id: 'layers', commands: { detach: 'custom.detach' } }));
    expect(getPanelCommandIds('layers').detach).toBe('custom.detach');
  });
});

describe('panel registry: lifecycle contract', () => {
  it('a valid detachable definition passes validation', () => {
    resetPanelRegistry();
    const def = detachableDefinition();
    expect(validatePanelDefinition(def)).toEqual([]);
    registerPanel(def);
    expect(isPanelDetachable('layers')).toBe(true);
  });

  it('local-state codecs carry a byte budget', () => {
    expect(DEFAULT_PANEL_LOCAL_STATE_BYTES).toBe(64 * 1024);
    const codec: PanelLocalStateCodec = {
      maxBytes: DEFAULT_PANEL_LOCAL_STATE_BYTES,
      encode: () => null,
      decode: () => null,
    };
    expect(codec.maxBytes).toBeGreaterThan(0);
  });
});
