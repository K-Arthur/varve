import { describe, expect, it } from 'vitest';
import { getWorkspaceConfig, WORKSPACE_CONFIGS, WORKSPACE_LABELS } from './workspaceTypes';

describe('WorkspaceConfig', () => {
  it('design mode shows all panels', () => {
    const config = getWorkspaceConfig('design');
    expect(config.visiblePanels.layers).toBe(true);
    expect(config.visiblePanels.inspector).toBe(true);
    expect(config.visiblePanels.pagenav).toBe(true);
    expect(config.floatingToolbar).toBe(true);
    expect(config.statusBar).toBe(true);
  });

  it('design mode shows rulers, guides, and dot grid', () => {
    const config = getWorkspaceConfig('design');
    expect(config.canvasOverlays?.rulers).toBe(true);
    expect(config.canvasOverlays?.guides).toBe(true);
    expect(config.canvasOverlays?.dotGrid).toBe(true);
    expect(config.canvasOverlays?.pixelGrid).toBe(false);
  });

  it('print mode shows all panels', () => {
    const config = getWorkspaceConfig('print');
    expect(config.visiblePanels.layers).toBe(true);
    expect(config.visiblePanels.inspector).toBe(true);
    expect(config.visiblePanels.pagenav).toBe(true);
    expect(config.floatingToolbar).toBe(true);
    expect(config.statusBar).toBe(true);
  });

  it('print mode has preflight status and no default tool override', () => {
    const config = getWorkspaceConfig('print');
    expect(config.statusSections?.preflight).toBe(true);
    expect(config.defaultTool).toBeUndefined();
  });

  it('drawing mode hides pagenav and sets paint as default tool', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.visiblePanels.pagenav).toBe(false);
    expect(config.defaultTool).toBe('paint');
  });

  it('drawing mode hides guides by default', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.canvasOverlays?.guides).toBe(false);
  });

  it('drawing mode shows rulers and dot grid', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.canvasOverlays?.rulers).toBe(true);
    expect(config.canvasOverlays?.dotGrid).toBe(true);
  });

  it('getWorkspaceConfig is stable (same object reference for same mode)', () => {
    const a = getWorkspaceConfig('design');
    const b = WORKSPACE_CONFIGS.design;
    expect(a).toBe(b);
  });

  it('all workspace configs have valid structure', () => {
    for (const mode of ['design', 'print', 'drawing'] as const) {
      const c = WORKSPACE_CONFIGS[mode];
      expect(typeof c.visiblePanels.layers).toBe('boolean');
      expect(typeof c.visiblePanels.inspector).toBe('boolean');
      expect(typeof c.visiblePanels.timeline).toBe('boolean');
      expect(typeof c.visiblePanels.pagenav).toBe('boolean');
      expect(typeof c.floatingToolbar).toBe('boolean');
      expect(typeof c.statusBar).toBe('boolean');
      expect(typeof c.tabStrip).toBe('boolean');
      expect(c.canvasOverlays).toBeDefined();
      expect(c.statusSections).toBeDefined();
    }
  });

  it('all status sections are defined for all modes', () => {
    for (const mode of ['design', 'print', 'drawing'] as const) {
      const c = WORKSPACE_CONFIGS[mode];
      expect(c.statusSections?.toolName).toBeDefined();
      expect(c.statusSections?.cursorPos).toBeDefined();
      expect(c.statusSections?.zoom).toBeDefined();
      expect(c.statusSections?.selectionInfo).toBeDefined();
      expect(c.statusSections?.unit).toBeDefined();
      expect(c.statusSections?.preflight).toBeDefined();
    }
  });

  it('all canvas overlays are defined for all modes', () => {
    for (const mode of ['design', 'print', 'drawing'] as const) {
      const c = WORKSPACE_CONFIGS[mode];
      expect(c.canvasOverlays?.rulers).toBeDefined();
      expect(c.canvasOverlays?.guides).toBeDefined();
      expect(c.canvasOverlays?.pixelGrid).toBeDefined();
      expect(c.canvasOverlays?.dotGrid).toBeDefined();
    }
  });

  it('labels are defined for all modes', () => {
    expect(Object.keys(WORKSPACE_LABELS).sort()).toEqual(['design', 'drawing', 'print']);
  });

  it('timeline panel is hidden in all modes by default', () => {
    for (const mode of ['design', 'print', 'drawing'] as const) {
      expect(WORKSPACE_CONFIGS[mode].visiblePanels.timeline).toBe(false);
    }
  });
});
