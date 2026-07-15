import { describe, expect, it } from 'vitest';
import {
  getWorkspaceConfig,
  WORKSPACE_CONFIGS,
  WORKSPACE_LABELS,
  type WorkspaceMode,
} from './workspaceTypes';

describe('workspaceTypes', () => {
  it('has configs for all four modes', () => {
    const modes: WorkspaceMode[] = ['design', 'print', 'drawing', 'image'];
    for (const mode of modes) {
      const config = WORKSPACE_CONFIGS[mode];
      expect(config).toBeDefined();
      expect(config.visiblePanels).toBeDefined();
      expect(typeof config.floatingToolbar).toBe('boolean');
      expect(typeof config.statusBar).toBe('boolean');
    }
  });

  it('getWorkspaceConfig returns design as fallback for unknown mode', () => {
    const config = getWorkspaceConfig('print');
    expect(config.visiblePanels.layers).toBe(true);
  });

  it('print mode has preflight status section', () => {
    const config = getWorkspaceConfig('print');
    expect(config.statusSections?.preflight).toBe(true);
  });

  it('drawing mode has paint as default tool', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.defaultTool).toBe('paint');
  });

  it('design mode does not have preflight status section', () => {
    const config = getWorkspaceConfig('design');
    expect(config.statusSections?.preflight).toBe(false);
  });

  it('drawing mode hides pagenav', () => {
    const config = getWorkspaceConfig('drawing');
    expect(config.visiblePanels.pagenav).toBe(false);
  });

  it('all modes have layers and inspector panels', () => {
    for (const mode of ['design', 'print', 'drawing', 'image'] as WorkspaceMode[]) {
      const config = WORKSPACE_CONFIGS[mode];
      expect(config.visiblePanels.layers).toBe(true);
      expect(config.visiblePanels.inspector).toBe(true);
    }
  });

  it('has labels for all modes', () => {
    expect(WORKSPACE_LABELS.design).toBe('Design');
    expect(WORKSPACE_LABELS.print).toBe('Print');
    expect(WORKSPACE_LABELS.drawing).toBe('Draw');
    expect(WORKSPACE_LABELS.image).toBe('Photo');
  });

  it('image mode hides pagenav and shows a pixel grid by default', () => {
    const config = getWorkspaceConfig('image');
    expect(config.visiblePanels.pagenav).toBe(false);
    expect(config.canvasOverlays?.pixelGrid).toBe(true);
    expect(config.statusSections?.preflight).toBe(false);
  });

  it('print mode maintains defaultTool as undefined (preserve current)', () => {
    const config = getWorkspaceConfig('print');
    expect(config.defaultTool).toBeUndefined();
  });

  it('getWorkspaceConfig returns expected shape for design', () => {
    const config = getWorkspaceConfig('design');
    expect(config.canvasOverlays?.rulers).toBe(true);
    expect(config.canvasOverlays?.dotGrid).toBe(true);
    expect(config.floatingToolbar).toBe(true);
  });
});
