import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../panelDefinitions';
import { resetPanelRegistry } from '../panelRegistry';
import { resolveDockTreeGeometry } from './dockGeometry';
import { listPanelInstances, validateDockLayout } from './dockOps';
import type { DockLayout } from './dockTypes';
import { completeEditorDockLayout, createDefaultEditorDockLayout } from './editorDockLayout';

describe('editor dock defaults', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('keeps the canvas between Layers and Inspector in every workspace', () => {
    for (const mode of ['design', 'print', 'drawing', 'image', 'motion', 'email'] as const) {
      const layout = createDefaultEditorDockLayout(mode);
      expect(validateDockLayout(layout)).toEqual([]);
      const primary = layout.windows[0]!.dockRoot;
      expect(listPanelInstances(primary).map((panel) => panel.panelTypeId)).toContain('layers');
      expect(listPanelInstances(primary).map((panel) => panel.panelTypeId)).toContain('inspector');
    }
  });

  it('gives the default Inspector enough width for desktop controls', () => {
    const layout = createDefaultEditorDockLayout('design');
    const geometry = resolveDockTreeGeometry(layout.windows[0]!.dockRoot, 1280, 720);
    const inspector = geometry.panels.find((panel) => panel.panelTypeId === 'inspector');

    expect(inspector?.rect.width).toBeCloseTo(310, 0);
    expect(geometry.canvas?.width).toBeGreaterThanOrEqual(320);
  });

  it('adds missing required surfaces to early canvas-only snapshots', () => {
    const legacy: DockLayout = {
      schemaVersion: 2,
      windows: [{ id: 'main', role: 'primary', dockRoot: { kind: 'canvas', id: 'canvas' } }],
    };
    const recovered = completeEditorDockLayout(legacy, 'email', false, false, ['emailOutput']);
    expect(validateDockLayout(recovered)).toEqual([]);
    expect(
      listPanelInstances(recovered.windows[0]!.dockRoot).map((panel) => panel.panelTypeId),
    ).toEqual(['layers', 'emailPreview', 'emailOutput', 'inspector']);
    expect(listPanelInstances(legacy.windows[0]!.dockRoot)).toEqual([]);
  });

  it('keeps Email Output in a tab group with Preview in the default Email layout', () => {
    const layout = createDefaultEditorDockLayout('email');
    const primary = layout.windows[0]!.dockRoot;
    expect(validateDockLayout(layout)).toEqual([]);
    expect(listPanelInstances(primary).map((panel) => panel.panelTypeId)).toEqual([
      'layers',
      'emailPreview',
      'emailOutput',
      'inspector',
    ]);
    const outputTabs = findTabsWith(primary, ['emailPreview', 'emailOutput']);
    expect(outputTabs?.activePanelInstanceId).toBe('builtin-emailPreview');
  });

  it('preserves customized panel locations when completing a partial layout', () => {
    const custom = createDefaultEditorDockLayout('design');
    const completed = completeEditorDockLayout(custom, 'design');
    expect(completed.windows[0]?.dockRoot).toEqual(custom.windows[0]?.dockRoot);
    expect(validateDockLayout(completed)).toEqual([]);
  });

  it('keeps runtime-only panel completion stable across renders', () => {
    const saved = createDefaultEditorDockLayout('print');
    const first = completeEditorDockLayout(saved, 'print', false, false, ['pagenav']);
    const second = completeEditorDockLayout(saved, 'print', false, false, ['pagenav']);

    expect(second).toEqual(first);
    expect(validateDockLayout(first)).toEqual([]);
  });

  it('does not duplicate panels that are already in a floating group', () => {
    const layout: DockLayout = {
      schemaVersion: 3,
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: { kind: 'canvas', id: 'canvas' },
          floatingGroups: [
            {
              id: 'float-layers',
              panels: [{ instanceId: 'builtin-layers', panelTypeId: 'layers' }],
              activePanelInstanceId: 'builtin-layers',
              normalizedBounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 },
            },
          ],
        },
      ],
    };

    const completed = completeEditorDockLayout(layout, 'design');
    const panels = [
      ...listPanelInstances(completed.windows[0]!.dockRoot),
      ...(completed.windows[0]!.floatingGroups ?? []).flatMap((group) => group.panels),
    ];
    expect(panels.filter((panel) => panel.panelTypeId === 'layers')).toHaveLength(1);
    expect(completed.windows[0]!.floatingGroups).toEqual(layout.windows[0]!.floatingGroups);
    expect(validateDockLayout(completed)).toEqual([]);
  });
});

function findTabsWith(
  node: import('./dockTypes').DockNode,
  panelTypes: readonly string[],
): Extract<import('./dockTypes').DockNode, { kind: 'tabs' }> | undefined {
  if (
    node.kind === 'tabs' &&
    panelTypes.every((type) => node.panels.some((panel) => panel.panelTypeId === type))
  ) {
    return node;
  }
  if (node.kind !== 'split') return undefined;
  return findTabsWith(node.first, panelTypes) ?? findTabsWith(node.second, panelTypes);
}
