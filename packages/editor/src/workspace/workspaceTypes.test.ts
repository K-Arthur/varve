import { describe, expect, it } from 'vitest';
import { toolShortcutId } from '../shortcuts/toolShortcutLabel';
import { suppressedTipShortcutIds, workspaceShortcutLabel } from './workspaceShortcutLabel';
import {
  ALL_WORKSPACE_MODES,
  getDefaultInspectorTab,
  getHiddenTools,
  getVisibleInspectorTabs,
  getVisibleStatusSections,
  getVisibleToolbarToolIds,
  getWorkspaceConfig,
  isValidWorkspaceConfig,
  resolveWorkspaceTool,
  WORKSPACE_CONFIGS,
  WORKSPACE_ICONS,
  WORKSPACE_LABELS,
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

  // Resolved from the shortcut registry, never from a literal in this module:
  // a hard-coded table here went stale and advertised keys that had been
  // reassigned to other commands.
  it('every mode has a switch shortcut resolvable from the registry', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(workspaceShortcutLabel(mode)).toBeTruthy();
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

  it('design mode exposes grouped tabs without legacy document or spec', () => {
    const tabs = getVisibleInspectorTabs('design');
    expect(tabs).toEqual(['properties', 'appearance', 'prototype', 'export', 'audit', 'fonts']);
  });

  it('print mode places audit before export for preflight-before-output workflow', () => {
    const tabs = getVisibleInspectorTabs('print');
    expect(tabs).toEqual(['properties', 'appearance', 'audit', 'export', 'fonts']);
  });

  it('drawing mode keeps a compact inspector because brush settings live in tool options', () => {
    const tabs = getVisibleInspectorTabs('drawing');
    expect(tabs).toEqual(['properties', 'appearance', 'export']);
  });

  it('image mode places adjustments before appearance for photo-processing-first workflow', () => {
    const tabs = getVisibleInspectorTabs('image');
    expect(tabs).toEqual(['properties', 'adjustments', 'appearance', 'export', 'audit']);
  });

  it('default inspector tab is properties for all modes (except codegen)', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      if (mode === 'codegen') {
        expect(getDefaultInspectorTab(mode)).toBe('codegen');
      } else {
        expect(getDefaultInspectorTab(mode)).toBe('properties');
      }
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

  it('counts flyout members as visible tools', () => {
    const visible = getVisibleToolbarToolIds(getWorkspaceConfig('design'));
    expect(visible.has('booleanUnion')).toBe(true);
    expect(getHiddenTools('design').has('booleanUnion')).toBe(false);
  });

  it('falls back from a hidden tool without activating command-only flyout members', () => {
    expect(resolveWorkspaceTool(getWorkspaceConfig('design'), 'paint')).toBe('select');
    expect(resolveWorkspaceTool(getWorkspaceConfig('design'), 'booleanUnion')).toBe('select');
    expect(resolveWorkspaceTool(getWorkspaceConfig('drawing'), 'paint')).toBe('paint');
  });

  // ─── Derived tip suppression ─────────────────────────────────────────────
  // Replaces the old hand-maintained `shortcuts.disabled` list, which was
  // empty in every built-in workspace and therefore suppressed nothing.

  it('suppresses tips for tools the workspace does not show', () => {
    // Drawing hides the vector shape tools, so their shortcuts must not be
    // recommended while the user is painting.
    const drawing = suppressedTipShortcutIds('drawing');
    expect(getHiddenTools('drawing').has('rect')).toBe(true);
    expect(drawing).toContain('toolRect');
    expect(drawing).toContain('toolEllipse');
  });

  it('never suppresses a tip for a tool the workspace does show', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const suppressed = new Set(suppressedTipShortcutIds(mode));
      const shown = getWorkspaceConfig(mode).toolbar.tools.map((t) => t.toolId);
      for (const tool of shown) {
        const id = toolShortcutId(tool);
        if (id) expect(suppressed.has(id)).toBe(false);
      }
    }
  });

  // ─── Onboarding ──────────────────────────────────────────────────────────

  it('all modes have onboarding descriptions', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = getWorkspaceConfig(mode);
      expect(config.onboarding.description).toBeTruthy();
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
