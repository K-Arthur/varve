import { describe, expect, it } from 'vitest';
import { formatShortcut, getEffectiveBinding } from '../shortcuts/ShortcutManager';
import { workspaceShortcutLabel } from './workspaceShortcutLabel';
import {
  getVisibleInspectorTabs,
  getVisibleStatusSections,
  getWorkspaceConfig,
  WORKSPACE_CONFIG_VERSION,
  type WorkspaceMode,
} from './workspaceTypes';

describe('Workspace mode switching — motion mode', () => {
  describe('switching to motion mode', () => {
    it('shows timeline panel', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.panels.timeline.visible).toBe(true);
    });

    it('shows layers panel', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.panels.layers.visible).toBe(true);
    });

    it('shows inspector panel', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.panels.inspector.visible).toBe(true);
    });

    it('shows page navigation', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.panels.pagenav.visible).toBe(true);
    });

    it('sets select as default tool', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.defaultTool).toBe('select');
    });

    it('shows floating toolbar', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.floatingToolbar).toBe(true);
    });

    it('shows status bar', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.statusBar).toBe(true);
    });

    // The workspace config no longer declares key bindings. It never had a
    // mechanism to register them — ShortcutManager holds one global binding
    // per action id — so the old assertions passed while the keys they named
    // did nothing when pressed. What is worth locking in is that the mode's
    // own switch shortcut resolves from the registry that actually fires.
    it('resolves its switch shortcut from the live registry', () => {
      expect(workspaceShortcutLabel('motion')).toBe(
        formatShortcut(getEffectiveBinding('workspaceMotion')),
      );
      expect(workspaceShortcutLabel('motion')).toBeTruthy();
    });

    it('has motion-specific status sections', () => {
      const sections = getVisibleStatusSections('motion');
      expect(sections).toContain('toolName');
      expect(sections).toContain('cursorPos');
      expect(sections).toContain('zoom');
      expect(sections).toContain('selectionInfo');
    });

    it('has motion-specific inspector tabs', () => {
      const tabs = getVisibleInspectorTabs('motion');
      expect(tabs).toEqual(['properties', 'appearance', 'prototype', 'export', 'audit']);
    });

    it('enables rulers and guides', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.canvasOverlays.rulers).toBe(true);
      expect(config.canvasOverlays.guides).toBe(true);
    });

    it('enables dot grid', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.canvasOverlays.dotGrid).toBe(true);
    });

    it('disables pixel grid', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.canvasOverlays.pixelGrid).toBe(false);
    });

    it('disables bleed guides', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.canvasOverlays.bleedGuides).toBe(false);
    });

    it('declares the current config schema version', () => {
      // All built-ins must agree with WORKSPACE_CONFIG_VERSION. A lone
      // higher number is a migration contract that nothing implements — it
      // reads as a schema level that does not exist (motion used to claim
      // version 2 while the constant was 1).
      const config = getWorkspaceConfig('motion');
      expect(config.version).toBe(WORKSPACE_CONFIG_VERSION);
      expect(WORKSPACE_CONFIG_VERSION).toBe(1);
    });

    it('has preferred width for timeline panel', () => {
      const config = getWorkspaceConfig('motion');
      expect(config.panels.timeline.preferredWidth).toBe('100%');
    });
  });

  describe('state preservation — motion mode preserves design state', () => {
    it('does not change layers panel visibility when switching to motion', () => {
      const designConfig = getWorkspaceConfig('design');
      const motionConfig = getWorkspaceConfig('motion');
      expect(designConfig.panels.layers.visible).toBe(motionConfig.panels.layers.visible);
    });

    it('does not change inspector panel visibility when switching to motion', () => {
      const designConfig = getWorkspaceConfig('design');
      const motionConfig = getWorkspaceConfig('motion');
      expect(designConfig.panels.inspector.visible).toBe(motionConfig.panels.inspector.visible);
    });

    it('same floating toolbar visibility in design and motion', () => {
      const designConfig = getWorkspaceConfig('design');
      const motionConfig = getWorkspaceConfig('motion');
      expect(designConfig.floatingToolbar).toBe(motionConfig.floatingToolbar);
    });

    it('same status bar visibility in design and motion', () => {
      const designConfig = getWorkspaceConfig('design');
      const motionConfig = getWorkspaceConfig('motion');
      expect(designConfig.statusBar).toBe(motionConfig.statusBar);
    });
  });

  describe('switching away from motion mode', () => {
    it('hides timeline panel in design mode', () => {
      const config = getWorkspaceConfig('design');
      expect(config.panels.timeline.visible).toBe(false);
    });

    it('hides timeline panel in print mode', () => {
      const config = getWorkspaceConfig('print');
      expect(config.panels.timeline.visible).toBe(false);
    });

    it('hides timeline panel in drawing mode', () => {
      const config = getWorkspaceConfig('drawing');
      expect(config.panels.timeline.visible).toBe(false);
    });

    it('hides timeline panel in image mode', () => {
      const config = getWorkspaceConfig('image');
      expect(config.panels.timeline.visible).toBe(false);
    });

    it('preserves layers and inspector visibility when switching back to design', () => {
      const config = getWorkspaceConfig('design');
      expect(config.panels.layers.visible).toBe(true);
      expect(config.panels.inspector.visible).toBe(true);
    });
  });

  describe('all modes have consistent structure', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image', 'motion'];

    it.each(modes)('mode "%s" has valid panel layout', (mode) => {
      const config = getWorkspaceConfig(mode);
      expect(config.panels.layers).toBeDefined();
      expect(config.panels.inspector).toBeDefined();
      expect(config.panels.timeline).toBeDefined();
      expect(typeof config.panels.layers.visible).toBe('boolean');
      expect(typeof config.panels.inspector.visible).toBe('boolean');
      expect(typeof config.panels.timeline.visible).toBe('boolean');
    });

    it.each(modes)('mode "%s" has status bar', (mode) => {
      const config = getWorkspaceConfig(mode);
      expect(typeof config.statusBar).toBe('boolean');
    });

    it.each(modes)('mode "%s" has floating toolbar', (mode) => {
      const config = getWorkspaceConfig(mode);
      expect(typeof config.floatingToolbar).toBe('boolean');
    });

    it('only motion mode has timeline visible by default', () => {
      for (const mode of modes) {
        const config = getWorkspaceConfig(mode);
        if (mode === 'motion') {
          expect(config.panels.timeline.visible).toBe(true);
        } else {
          expect(config.panels.timeline.visible).toBe(false);
        }
      }
    });
  });
});
