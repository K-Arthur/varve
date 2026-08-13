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
import {
  clampPanelWidthToViewport,
  defaultPanelWidth,
  type PanelSide,
} from '../components/PanelResizeHandle';
import { subscribeWorkspaceReset } from './workspaceResetEvents';
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

      // Restore the new workspace's widths
      const newPrefs = getWorkspacePreferences();
      const savedWidths = getPanelWidths(newPrefs, workspaceMode);
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1440;

      if (savedWidths.layers !== undefined) {
        const otherWidth = widths.inspector ?? defaultPanelWidth('inspector', viewport);
        const clamped = clampPanelWidthToViewport(
          'layers',
          savedWidths.layers,
          otherWidth,
          viewport,
        );
        setWidth('layers', clamped);
      }
      if (savedWidths.inspector !== undefined) {
        const otherWidth = widths.layers ?? defaultPanelWidth('layers', viewport);
        const clamped = clampPanelWidthToViewport(
          'inspector',
          savedWidths.inspector,
          otherWidth,
          viewport,
        );
        setWidth('inspector', clamped);
      }

      prevModeRef.current = workspaceMode;
    }
  }, [workspaceMode, widths.layers, widths.inspector, setWidth]);
}
