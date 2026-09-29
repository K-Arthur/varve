import { describe, expect, it } from 'vitest';
import {
  ALL_WORKSPACE_MODES,
  getVisibleStatusSections,
  getWorkspaceConfig,
  WORKSPACE_CONFIGS,
  WORKSPACE_LABELS,
} from './workspaceTypes';

describe('WorkspaceConfig', () => {
  it('design mode shows all panels', () => {
    const config = getWorkspaceConfig('design');
    expect(config.panels.layers.visible).toBe(true);
    expect(config.panels.inspector.visible).toBe(true);
    expect(config.panels.pagenav.visible).toBe(true);
    expect(config.floatingToolbar).toBe(true);
    expect(config.statusBar).toBe(true);
  });

  it('design mode shows rulers, guides, and dot grid', () => {
    const config = getWorkspaceConfig('design');
    expect(config.canvasOverlays.rulers).toBe(true);
    expect(config.canvasOverlays.guides).toBe(true);
    expect(config.canvasOverlays.dotGrid).toBe(true);
    expect(config.canvasOverlays.pixelGrid).toBe(false);
  });

  it('print mode shows all panels', () => {
    const config = getWorkspaceConfig('print');
    expect(config.panels.layers.visible).toBe(true);
    expect(config.panels.inspector.visible).toBe(true);
    expect(config.panels.pagenav.visible).toBe(true);
    expect(config.floatingToolbar).toBe(true);
    expect(config.statusBar).toBe(true);
  });

  it('print mode has preflight status and select as default tool', () => {
    const config = getWorkspaceConfig('print');
    const sections = getVisibleStatusSections('print');
    expect(sections).toContain('preflight');
    expect(config.defaultTool).toBe('select');
  });

  it('drawing mode hides pagenav and sets paint as default tool', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.panels.pagenav.visible).toBe(false);
    expect(config.defaultTool).toBe('paint');
  });

  it('drawing mode hides guides by default', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.canvasOverlays.guides).toBe(false);
  });

  it('drawing mode shows rulers and dot grid', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.canvasOverlays.rulers).toBe(true);
    expect(config.canvasOverlays.dotGrid).toBe(true);
  });

  it('getWorkspaceConfig is stable (same object reference for same mode)', () => {
    const a = getWorkspaceConfig('design');
    const b = WORKSPACE_CONFIGS.design;
    expect(a).toBe(b);
  });

  it('all workspace configs have valid structure', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const c = WORKSPACE_CONFIGS[mode];
      expect(typeof c.panels.layers.visible).toBe('boolean');
      expect(typeof c.panels.inspector.visible).toBe('boolean');
      expect(typeof c.panels.timeline.visible).toBe('boolean');
      expect(typeof c.panels.pagenav.visible).toBe('boolean');
      expect(typeof c.floatingToolbar).toBe('boolean');
      expect(typeof c.statusBar).toBe('boolean');
      expect(typeof c.tabStrip).toBe('boolean');
      expect(c.canvasOverlays).toBeDefined();
      expect(Array.isArray(c.statusSections)).toBe(true);
    }
  });

  it('all status sections are defined for all modes', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const sections = getVisibleStatusSections(mode);
      expect(sections.length).toBeGreaterThan(0);
      expect(sections).toContain('renderer');
      expect(sections).toContain('cursorPos');
      expect(sections).toContain('zoom');
      expect(sections).toContain('saveStatus');
      // One id per fact: the active tool and the selection readout live in
      // the palette and in SelectionInfoBar respectively.
      expect(sections).not.toContain('toolName');
      expect(sections).not.toContain('selectionInfo');
    }
  });

  it('all canvas overlays are defined for all modes', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const c = WORKSPACE_CONFIGS[mode];
      expect(c.canvasOverlays.rulers).toBeDefined();
      expect(c.canvasOverlays.guides).toBeDefined();
      expect(c.canvasOverlays.pixelGrid).toBeDefined();
      expect(c.canvasOverlays.dotGrid).toBeDefined();
      expect(c.canvasOverlays.bleedGuides).toBeDefined();
      expect(c.canvasOverlays.layoutGrid).toBeDefined();
      expect(c.canvasOverlays.baselineGrid).toBeDefined();
    }
  });

  it('labels are defined for exactly the current modes', () => {
    // Derived from the mode list rather than written out: Logo and Codegen
    // stopped being workspace modes, and a hand-maintained copy of the keys
    // outlived them.
    expect(Object.keys(WORKSPACE_LABELS).sort()).toEqual([...ALL_WORKSPACE_MODES].sort());
  });

  it('timeline panel is hidden in all modes by default except motion', () => {
    for (const mode of ['design', 'print', 'drawing', 'image'] as const) {
      expect(WORKSPACE_CONFIGS[mode].panels.timeline.visible).toBe(false);
    }
    expect(WORKSPACE_CONFIGS.motion.panels.timeline.visible).toBe(true);
  });

  it('image mode hides pagenav and preserves the current tool', () => {
    const config = getWorkspaceConfig('image');
    expect(config.panels.pagenav.visible).toBe(false);
    expect(config.defaultTool).toBeUndefined();
  });

  it('image mode shows a pixel grid and hides the dot grid', () => {
    const config = getWorkspaceConfig('image');
    expect(config.canvasOverlays.pixelGrid).toBe(true);
    expect(config.canvasOverlays.dotGrid).toBe(false);
  });

  it('print mode enables bleed guides', () => {
    const config = getWorkspaceConfig('print');
    expect(config.canvasOverlays.bleedGuides).toBe(true);
  });

  // Renderer policy is deliberately NOT a workspace concern. It belongs to the
  // global render/performance settings and the adaptive memory budget, which
  // can see hardware capability, memory pressure, and scene complexity; a
  // workspace switch is a layout change and must not reconfigure the renderer
  // as a side effect. See the removal note in workspaceTypes.ts.
  it('does not carry renderer policy', () => {
    const config = getWorkspaceConfig('design') as unknown as Record<string, unknown>;
    expect(config.performance).toBeUndefined();
  });

  it('each mode has its own toolbar tool set', () => {
    const toolSet = (mode: keyof typeof WORKSPACE_CONFIGS) =>
      new Set(WORKSPACE_CONFIGS[mode].toolbar.tools.map((t) => t.toolId));
    const designTools = toolSet('design');
    const drawingTools = toolSet('drawing');
    // Draw leads with paint and defaults to it. Design also carries paint now
    // (Shading layers live there), so the old "design must not have paint"
    // premise is gone; what must hold is that neither workspace is a copy of
    // the other's.
    expect(WORKSPACE_CONFIGS.drawing.defaultTool).toBe('paint');
    expect(drawingTools.has('paint')).toBe(true);
    expect(drawingTools).not.toEqual(designTools);
    expect(designTools.size).toBeGreaterThan(0);
  });
});
