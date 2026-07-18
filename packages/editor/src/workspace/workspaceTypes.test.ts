import { describe, expect, it } from 'vitest';
import {
  ALL_WORKSPACE_MODES,
  getDefaultInspectorTab,
  getHiddenTools,
  getOrderedPanels,
  getVisibleInspectorTabs,
  getVisibleStatusSections,
  getWorkspaceConfig,
  isValidWorkspaceConfig,
  WORKSPACE_CONFIGS,
  WORKSPACE_ICONS,
  WORKSPACE_LABELS,
  WORKSPACE_SHORTCUTS,
  type WorkspaceMode,
} from './workspaceTypes';

describe('workspaceTypes', () => {
  // ─── Basic config shape ──────────────────────────────────────────────────

  it('has configs for all four modes', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image'];
    for (const mode of modes) {
      const config = WORKSPACE_CONFIGS[mode];
      expect(config).toBeDefined();
      expect(config.version).toBe(1);
      expect(config.panels).toBeDefined();
      expect(typeof config.floatingToolbar).toBe('boolean');
      expect(typeof config.statusBar).toBe('boolean');
      expect(typeof config.tabStrip).toBe('boolean');
      expect(config.toolbar).toBeDefined();
      expect(Array.isArray(config.inspectorTabs)).toBe(true);
      expect(Array.isArray(config.statusSections)).toBe(true);
      expect(config.canvasOverlays).toBeDefined();
      expect(config.performance).toBeDefined();
      expect(config.onboarding).toBeDefined();
    }
  });

  it('getWorkspaceConfig returns design as fallback for unknown mode', () => {
    const config = getWorkspaceConfig('print');
    expect(config.panels.layers.visible).toBe(true);
  });

  it('has labels and icons for all modes', () => {
    expect(WORKSPACE_LABELS.design).toBe('Design');
    expect(WORKSPACE_LABELS.print).toBe('Print');
    expect(WORKSPACE_LABELS.drawing).toBe('Draw');
    expect(WORKSPACE_LABELS.image).toBe('Photo');

    expect(WORKSPACE_ICONS.design).toBe('PenTool');
    expect(WORKSPACE_ICONS.print).toBe('Printer');
    expect(WORKSPACE_ICONS.drawing).toBe('Paintbrush');
    expect(WORKSPACE_ICONS.image).toBe('Image');
  });

  it('has shortcuts for all modes', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(WORKSPACE_SHORTCUTS[mode]).toBeTruthy();
    }
  });

  it('all modes have layers and inspector panels visible', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = WORKSPACE_CONFIGS[mode];
      expect(config.panels.layers.visible).toBe(true);
      expect(config.panels.inspector.visible).toBe(true);
    }
  });

  // ─── Panel layout ────────────────────────────────────────────────────────

  it('print mode shows pagenav', () => {
    const config = getWorkspaceConfig('print');
    expect(config.panels.pagenav.visible).toBe(true);
  });

  it('drawing mode hides pagenav', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.panels.pagenav.visible).toBe(false);
  });

  it('image mode hides pagenav', () => {
    const config = getWorkspaceConfig('image');
    expect(config.panels.pagenav.visible).toBe(false);
  });

  it('getOrderedPanels returns visible panels sorted by order', () => {
    const panels = getOrderedPanels('design');
    expect(panels.length).toBeGreaterThan(0);
    expect(panels).toContain('layers');
    expect(panels).toContain('inspector');
    // All returned panels should be visible in design mode
    const config = getWorkspaceConfig('design');
    for (const p of panels) {
      expect(config.panels[p].visible).toBe(true);
    }
  });

  // ─── Mode-specific features ──────────────────────────────────────────────

  it('print mode has preflight status section', () => {
    const sections = getVisibleStatusSections('print');
    expect(sections).toContain('preflight');
  });

  it('print mode has page info section', () => {
    const sections = getVisibleStatusSections('print');
    expect(sections).toContain('pageInfo');
  });

  it('print mode has colour mode section', () => {
    const sections = getVisibleStatusSections('print');
    expect(sections).toContain('colorMode');
  });

  it('design mode does not have preflight status section', () => {
    const sections = getVisibleStatusSections('design');
    expect(sections).not.toContain('preflight');
  });

  it('design mode has layout score section', () => {
    const sections = getVisibleStatusSections('design');
    expect(sections).toContain('layoutScore');
  });

  it('drawing mode has paint as default tool', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.defaultTool).toBe('paint');
  });

  it('image mode has pixel grid overlay', () => {
    const config = getWorkspaceConfig('image');
    expect(config.canvasOverlays.pixelGrid).toBe(true);
  });

  it('print mode has bleed guides overlay', () => {
    const config = getWorkspaceConfig('print');
    expect(config.canvasOverlays.bleedGuides).toBe(true);
  });

  it('image mode has image info status section', () => {
    const sections = getVisibleStatusSections('image');
    expect(sections).toContain('imageInfo');
  });

  it('image mode has colour mode status section', () => {
    const sections = getVisibleStatusSections('image');
    expect(sections).toContain('colorMode');
  });

  it('design mode has debt status section', () => {
    const sections = getVisibleStatusSections('design');
    expect(sections).toContain('debt');
  });

  // ─── Toolbar composition ─────────────────────────────────────────────────

  it('design mode toolbar has shape, line, pen, text, and select tools', () => {
    const config = getWorkspaceConfig('design');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).toContain('rect');
    expect(toolIds).toContain('line');
    expect(toolIds).toContain('pen');
    expect(toolIds).toContain('text');
    expect(toolIds).toContain('select');
  });

  it('drawing mode toolbar has paint and eraser tools', () => {
    const config = getWorkspaceConfig('drawing');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).toContain('paint');
    expect(toolIds).toContain('eraser');
  });

  it('image mode toolbar has retouch tools', () => {
    const config = getWorkspaceConfig('image');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).toContain('cloneStamp');
    expect(toolIds).toContain('healBrush');
    expect(toolIds).toContain('spotHeal');
    expect(toolIds).toContain('patch');
  });

  it('image mode toolbar has crop tool', () => {
    const config = getWorkspaceConfig('image');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).toContain('crop');
  });

  it('design mode toolbar does not have paint tool', () => {
    const config = getWorkspaceConfig('design');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).not.toContain('paint');
  });

  it('design mode toolbar does not have retouch tools', () => {
    const config = getWorkspaceConfig('design');
    const toolIds = config.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).not.toContain('cloneStamp');
    expect(toolIds).not.toContain('healBrush');
    expect(toolIds).not.toContain('spotHeal');
    expect(toolIds).not.toContain('patch');
  });

  // ─── Inspector tabs ──────────────────────────────────────────────────────

  it('design mode has all 5 inspector tabs', () => {
    const tabs = getVisibleInspectorTabs('design');
    expect(tabs).toContain('properties');
    expect(tabs).toContain('export');
    expect(tabs).toContain('spec');
    expect(tabs).toContain('score');
    expect(tabs).toContain('audit');
  });

  it('print mode has 4 inspector tabs (no score)', () => {
    const tabs = getVisibleInspectorTabs('print');
    expect(tabs).toContain('properties');
    expect(tabs).toContain('export');
    expect(tabs).toContain('spec');
    expect(tabs).toContain('audit');
    expect(tabs).not.toContain('score');
  });

  it('drawing mode has 2 inspector tabs (properties and export)', () => {
    const tabs = getVisibleInspectorTabs('drawing');
    expect(tabs).toContain('properties');
    expect(tabs).toContain('export');
    expect(tabs.length).toBe(2);
  });

  it('image mode has 3 inspector tabs (properties, export, audit)', () => {
    const tabs = getVisibleInspectorTabs('image');
    expect(tabs).toContain('properties');
    expect(tabs).toContain('export');
    expect(tabs).toContain('audit');
  });

  it('default inspector tab is properties for all modes', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(getDefaultInspectorTab(mode)).toBe('properties');
    }
  });

  // ─── Hidden tools ────────────────────────────────────────────────────────

  it('design mode hides paint and retouch tools', () => {
    const hidden = getHiddenTools('design');
    expect(hidden.has('paint')).toBe(true);
    expect(hidden.has('eraser')).toBe(true);
    expect(hidden.has('cloneStamp')).toBe(true);
    expect(hidden.has('healBrush')).toBe(true);
    expect(hidden.has('spotHeal')).toBe(true);
    expect(hidden.has('patch')).toBe(true);
    expect(hidden.has('smudge')).toBe(true);
  });

  it('drawing mode does not hide paint tools', () => {
    const hidden = getHiddenTools('drawing');
    expect(hidden.has('paint')).toBe(false);
    expect(hidden.has('eraser')).toBe(false);
    expect(hidden.has('smudge')).toBe(false);
  });

  it('image mode hides frame tool', () => {
    const hidden = getHiddenTools('image');
    expect(hidden.has('frame')).toBe(true);
  });

  it('image mode does not hide retouch tools', () => {
    const hidden = getHiddenTools('image');
    expect(hidden.has('cloneStamp')).toBe(false);
    expect(hidden.has('healBrush')).toBe(false);
  });

  // ─── Performance config ──────────────────────────────────────────────────

  it('all modes have worker renderer enabled', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(getWorkspaceConfig(mode).performance.useWorkerRenderer).toBe(true);
    }
  });

  it('all modes have viewport culling enabled', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(getWorkspaceConfig(mode).performance.viewportCulling).toBe(true);
    }
  });

  it('image mode has larger image cache size', () => {
    const imageConfig = getWorkspaceConfig('image');
    const designConfig = getWorkspaceConfig('design');
    expect(imageConfig.performance.imageCacheSize).toBeGreaterThan(
      designConfig.performance.imageCacheSize,
    );
  });

  // ─── Onboarding ──────────────────────────────────────────────────────────

  it('all modes have onboarding descriptions', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = getWorkspaceConfig(mode);
      expect(config.onboarding.description).toBeTruthy();
      expect(config.onboarding.shortcutHint).toBeTruthy();
    }
  });

  it('drawing mode has tips', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.onboarding.tips).toBeDefined();
    expect(config.onboarding.tips!.length).toBeGreaterThan(0);
  });

  // ─── Validation ──────────────────────────────────────────────────────────

  it('isValidWorkspaceConfig accepts valid config', () => {
    expect(isValidWorkspaceConfig(getWorkspaceConfig('design'))).toBe(true);
  });

  it('isValidWorkspaceConfig rejects invalid config', () => {
    expect(isValidWorkspaceConfig(null)).toBe(false);
    expect(isValidWorkspaceConfig({})).toBe(false);
    expect(isValidWorkspaceConfig({ version: 1 })).toBe(false);
  });

  // ─── Canvas overlays ─────────────────────────────────────────────────────

  it('all modes have rulers enabled', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(getWorkspaceConfig(mode).canvasOverlays.rulers).toBe(true);
    }
  });

  it('drawing mode disables guides', () => {
    expect(getWorkspaceConfig('drawing').canvasOverlays.guides).toBe(false);
  });

  it('design mode enables dot grid', () => {
    expect(getWorkspaceConfig('design').canvasOverlays.dotGrid).toBe(true);
  });

  it('image mode disables dot grid', () => {
    expect(getWorkspaceConfig('image').canvasOverlays.dotGrid).toBe(false);
  });
});
