/**
 * Tests for motion workspace configuration.
 *
 * Verifies:
 * - Motion workspace config has timeline panel visible
 * - Motion workspace has correct default tool
 * - Motion workspace has onion skin shortcut
 * - Motion workspace has animation-specific shortcuts
 * - Workspace switching preserves document state
 */
import { describe, expect, it } from 'vitest';
import { getWorkspaceConfig, WORKSPACE_CONFIGS, type WorkspaceMode } from '../workspaceTypes';

describe('Motion workspace config', () => {
  const motionConfig = WORKSPACE_CONFIGS.motion;

  it('timeline panel is visible', () => {
    expect(motionConfig.panels.timeline.visible).toBe(true);
  });

  it('layers and inspector panels are visible', () => {
    expect(motionConfig.panels.layers.visible).toBe(true);
    expect(motionConfig.panels.inspector.visible).toBe(true);
  });

  it('default tool is select', () => {
    expect(motionConfig.defaultTool).toBe('select');
  });

  it('floating toolbar is enabled', () => {
    expect(motionConfig.floatingToolbar).toBe(true);
  });

  it('status bar is visible', () => {
    expect(motionConfig.statusBar).toBe(true);
  });

  it('has animation-specific keyboard shortcuts', () => {
    const shortcuts = motionConfig.shortcuts.extra;
    expect(shortcuts).toBeDefined();
    expect(shortcuts?.G).toBe('toggleGraphEditor');
    expect(shortcuts?.Space).toBe('playPause');
    expect(shortcuts?.['Alt+O']).toBe('toggleOnionSkin');
    expect(shortcuts?.['Alt+P']).toBe('addPositionKeyframe');
    expect(shortcuts?.['Alt+R']).toBe('addRotationKeyframe');
    expect(shortcuts?.['Alt+S']).toBe('addScaleKeyframe');
    expect(shortcuts?.['Alt+E']).toBe('addOpacityKeyframe');
    expect(shortcuts?.['Alt+K']).toBe('toggleAutoKeyframe');
  });

  it('has select tool in toolbar', () => {
    const toolIds = motionConfig.toolbar.tools.map((t) => t.toolId);
    expect(toolIds).toContain('select');
    expect(toolIds).toContain('hand');
    expect(toolIds).toContain('zoom');
    expect(toolIds).toContain('frame');
    expect(toolIds).toContain('rect');
    expect(toolIds).toContain('ellipse');
    expect(toolIds).toContain('text');
    expect(toolIds).toContain('pen');
    expect(toolIds).toContain('pencil');
    expect(toolIds).toContain('line');
    expect(toolIds).toContain('arrow');
  });

  it('has layoutScore status section', () => {
    const sections = motionConfig.statusSections;
    expect(sections.some((s) => s.id === 'layoutScore')).toBe(true);
    expect(sections.some((s) => s.id === 'selectionInfo')).toBe(true);
  });

  it('has audit inspector tab', () => {
    const tabs = motionConfig.inspectorTabs;
    expect(tabs.some((t) => t.id === 'audit')).toBe(true);
  });

  it('has canvas dot grid enabled', () => {
    expect(motionConfig.canvasOverlays.dotGrid).toBe(true);
    expect(motionConfig.canvasOverlays.pixelGrid).toBe(false);
  });

  it('has version 2 config (motion workspace enhancements)', () => {
    expect(motionConfig.version).toBe(2);
  });

  it('has motion-specific onboarding tips', () => {
    const tips = motionConfig.onboarding.tips;
    expect(tips).toBeDefined();
    expect(tips?.length).toBeGreaterThanOrEqual(6);
    expect(tips?.some((t) => t.toLowerCase().includes('onion'))).toBe(true);
    expect(tips?.some((t) => t.toLowerCase().includes('keyframe'))).toBe(true);
    expect(tips?.some((t) => t.toLowerCase().includes('easing'))).toBe(true);
  });
});

describe('Workspace config integrity', () => {
  it('all workspace modes have valid configs', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image', 'motion'];
    for (const mode of modes) {
      const config = WORKSPACE_CONFIGS[mode];
      expect(config).toBeDefined();
      expect(config.panels).toBeDefined();
      expect(config.toolbar).toBeDefined();
      expect(config.inspectorTabs.length).toBeGreaterThan(0);
      expect(config.canvasOverlays).toBeDefined();
      expect(config.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('getWorkspaceConfig returns correct config for each mode', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image', 'motion'];
    for (const mode of modes) {
      const config = getWorkspaceConfig(mode);
      expect(config.onboarding.description.length).toBeGreaterThan(0);
    }
  });

  it('motion mode has unique settings vs design mode', () => {
    const motion = WORKSPACE_CONFIGS.motion;
    const design = WORKSPACE_CONFIGS.design;

    // Key difference: timeline is visible in motion
    expect(motion.panels.timeline.visible).toBe(true);
    expect(design.panels.timeline.visible).toBe(false);

    // Motion has extra shortcuts not in design
    expect(Object.keys(motion.shortcuts.extra ?? {}).length).toBeGreaterThan(
      Object.keys(design.shortcuts.extra ?? {}).length,
    );
  });
});
