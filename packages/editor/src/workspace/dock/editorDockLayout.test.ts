import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../panelDefinitions';
import { resetPanelRegistry } from '../panelRegistry';
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
