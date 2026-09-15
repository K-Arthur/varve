/**
 * useWorkspacePanelWidths — per-workspace panel width persistence.
 *
 * Wraps usePanelWidths and adds workspace-aware save/restore:
 * - When the user resizes a panel, the width is saved to both global settings
 *   (for backward compatibility) and the active workspace's preferences.
 * - When the workspace changes, the previous workspace's widths are saved and
 *   the new workspace's saved widths are applied.
 */

import { useEffect, useRef } from 'react';
import type { PanelSide } from '../components/PanelResizeHandle';
import { subscribeWorkspaceLayoutApplied, subscribeWorkspaceReset } from './workspaceResetEvents';
import {
  getPanelWidths,
  getWorkspacePreferences,
  savePanelWidths,
  updateWorkspacePreferences,
} from './workspaceStore';
import type { PanelId, WorkspaceMode } from './workspaceTypes';

/**
 * useWorkspacePanelWidths — per-workspace panel width persistence.
 *
 * - When the workspace changes, the previous workspace's widths are saved and
 *   the new workspace's saved widths are applied.
 * - Reset events clear the live CSS overrides so a reset takes effect
 *   immediately, not only after a restart.
 *
 * `widths` are the user's desired widths (min/max clamped, not viewport
 * clamped). Persisting the desired value keeps a narrow window from
 * permanently overwriting the desktop arrangement; `usePanelWidths` clamps
 * only the value it renders.
 *
 * The return value was previously `{ saveCurrentWidths, restoreWorkspaceWidths }`
 * — exported but never consumed anywhere. Widths are written on switch and on
 * reset only, so those two callbacks were dead code and were removed.
 */
export function useWorkspacePanelWidths(
  workspaceMode: WorkspaceMode,
  widths: { layers: number | null; inspector: number | null },
  setWidth: (side: PanelSide, width: number | null) => void,
): void {
  const prevModeRef = useRef(workspaceMode);

  // Resetting preferences updates the store synchronously, but the shell's
  // width state is local to usePanelWidths. Clear the live CSS overrides too,
  // otherwise reset appears to work only after a restart.
  useEffect(() => {
    return subscribeWorkspaceReset((scope) => {
      if (scope.kind === 'all' || scope.mode === workspaceMode) {
        setWidth('layers', null);
        setWidth('inspector', null);
      }
    });
  }, [workspaceMode, setWidth]);

  // A named layout replaces the arrangement wholesale: apply the widths it
  // specifies and fall back to the default for panels it omits, so applying
  // a layout is reproducible rather than inheriting the previous widths.
  useEffect(() => {
    return subscribeWorkspaceLayoutApplied((detail) => {
      if (detail.mode !== workspaceMode) return;
      setWidth('layers', detail.panelWidths.layers ?? null);
      setWidth('inspector', detail.panelWidths.inspector ?? null);
    });
  }, [workspaceMode, setWidth]);

  // Save current widths when workspace changes
  useEffect(() => {
    if (prevModeRef.current !== workspaceMode) {
      // Save the old workspace's widths
      const widthsToSave: Partial<Record<PanelId, number>> = {};
      if (widths.layers !== null) widthsToSave.layers = widths.layers;
      if (widths.inspector !== null) widthsToSave.inspector = widths.inspector;
      if (Object.keys(widthsToSave).length > 0) {
        updateWorkspacePreferences((current) =>
          savePanelWidths(current, prevModeRef.current, widthsToSave),
        );
      }

      // Restore the new workspace's desired widths. Display-time viewport
      // clamping happens in `usePanelWidths`, so a small window does not
      // rewrite the saved value.
      const newPrefs = getWorkspacePreferences();
      const savedWidths = getPanelWidths(newPrefs, workspaceMode);
      if (savedWidths.layers !== undefined) {
        setWidth('layers', savedWidths.layers);
      }
      if (savedWidths.inspector !== undefined) {
        setWidth('inspector', savedWidths.inspector);
      }

      prevModeRef.current = workspaceMode;
    }
  }, [workspaceMode, widths.layers, widths.inspector, setWidth]);
}
