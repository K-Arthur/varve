import { type MutableRefObject, useCallback } from 'react';
import { updateSettings } from '../settings';
import type { ToolId } from '../tools/types';
import { getWorkspaceConfig, type WorkspaceMode } from '../workspace/workspaceTypes';
import { applyToolChange } from './ToolContext';
import type { EditorState } from './types';

export function useWorkspaceMode(
  state: EditorState,
  patch: (patch: Partial<EditorState>) => void,
  toolRef: MutableRefObject<ToolId>,
  announcerRef: MutableRefObject<{ announce: (message: string) => void } | null>,
  workspaceSwitchInProgressRef: MutableRefObject<boolean>,
) {
  const __setWorkspaceModeUnsafe = useCallback(
    (mode: WorkspaceMode) => {
      const config = getWorkspaceConfig(mode);
      const patchObj: Partial<EditorState> & Record<string, unknown> = {
        workspaceMode: mode,
        leftPanelVisible: config.panels.layers.visible,
        rightPanelVisible: config.panels.inspector.visible,
        timelinePanelVisible: config.panels.timeline.visible,
      };
      if (config.defaultTool && config.defaultTool !== state.tool) {
        patchObj.tool = config.defaultTool as ToolId;
      }
      patch(patchObj as Partial<EditorState>);
      updateSettings({
        panel: {
          leftPanelVisible: config.panels.layers.visible,
          rightPanelVisible: config.panels.inspector.visible,
        },
      });
      announcerRef.current?.announce(`Switched to ${mode} workspace`);
    },
    [state.tool, patch, announcerRef],
  );

  const requestWorkspaceSwitch = useCallback(
    (mode: WorkspaceMode, options?: { force?: boolean }): Promise<boolean> => {
      if (workspaceSwitchInProgressRef.current) return Promise.resolve(false);
      if (mode === state.workspaceMode) return Promise.resolve(false);
      workspaceSwitchInProgressRef.current = true;
      try {
        if (!options?.force) {
          if (
            state.tool === 'nodeEdit' ||
            state.tool === 'crop' ||
            state.maskPreviewMode !== 'none'
          ) {
            applyToolChange('select', toolRef, patch);
          }
        }
        const config = getWorkspaceConfig(mode);
        const patchObj: Partial<EditorState> & Record<string, unknown> = {
          workspaceMode: mode,
          leftPanelVisible: config.panels.layers.visible,
          rightPanelVisible: config.panels.inspector.visible,
          timelinePanelVisible: config.panels.timeline.visible,
        };
        if (config.defaultTool && config.defaultTool !== state.tool) {
          patchObj.tool = config.defaultTool as ToolId;
        }
        patch(patchObj as Partial<EditorState>);
        updateSettings({
          panel: {
            leftPanelVisible: config.panels.layers.visible,
            rightPanelVisible: config.panels.inspector.visible,
          },
        });
        announcerRef.current?.announce(`Switched to ${mode} workspace`);
        return Promise.resolve(true);
      } finally {
        workspaceSwitchInProgressRef.current = false;
      }
    },
    [state, patch, toolRef, announcerRef, workspaceSwitchInProgressRef],
  );

  const resetWorkspaceToDefault = useCallback(() => {
    const mode = state.workspaceMode;
    const config = getWorkspaceConfig(mode);
    const patchObj: Partial<EditorState> & Record<string, unknown> = {
      leftPanelVisible: config.panels.layers.visible,
      rightPanelVisible: config.panels.inspector.visible,
      timelinePanelVisible: config.panels.timeline.visible,
    };
    if (config.defaultTool) {
      patchObj.tool = config.defaultTool as ToolId;
    }
    patch(patchObj as Partial<EditorState>);
    announcerRef.current?.announce(`Reset ${mode} workspace to defaults`);
  }, [state.workspaceMode, patch, announcerRef]);

  return {
    __setWorkspaceModeUnsafe,
    requestWorkspaceSwitch,
    resetWorkspaceToDefault,
  };
}
