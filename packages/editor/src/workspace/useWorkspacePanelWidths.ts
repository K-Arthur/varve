/**
 * useWorkspacePanelWidths — per-workspace panel width persistence.
 *
 * Wraps usePanelWidths and adds workspace-aware save/restore:
 * - When the user resizes a panel, the width is saved to both global settings
 *   (for backward compatibility) and the active workspace's preferences.
 * - When the workspace changes, the previous workspace's widths are saved and
 *   the new workspace's saved widths are applied.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  clampPanelWidthToViewport,
  defaultPanelWidth,
  type PanelSide,
} from '../components/PanelResizeHandle';
import {
  getPanelWidths,
  getWorkspacePreferences,
  savePanelWidths,
  updateWorkspacePreferences,
} from './workspaceStore';
import type { PanelId, WorkspaceMode } from './workspaceTypes';

export function useWorkspacePanelWidths(
  workspaceMode: WorkspaceMode,
  widths: { layers: number | null; inspector: number | null },
  setWidth: (side: PanelSide, width: number | null) => void,
): {
  saveCurrentWidths: () => void;
  restoreWorkspaceWidths: (mode: WorkspaceMode) => void;
} {
  const prevModeRef = useRef(workspaceMode);

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

  const saveCurrentWidths = useCallback(() => {
    const widthsToSave: Partial<Record<PanelId, number>> = {};
    if (widths.layers !== null) widthsToSave.layers = widths.layers;
    if (widths.inspector !== null) widthsToSave.inspector = widths.inspector;
    if (Object.keys(widthsToSave).length > 0) {
      updateWorkspacePreferences((current) =>
        savePanelWidths(current, workspaceMode, widthsToSave),
      );
    }
  }, [workspaceMode, widths.layers, widths.inspector]);

  const restoreWorkspaceWidths = useCallback(
    (mode: WorkspaceMode) => {
      const prefs = getWorkspacePreferences();
      const savedWidths = getPanelWidths(prefs, mode);
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
    },
    [widths.layers, widths.inspector, setWidth],
  );

  return { saveCurrentWidths, restoreWorkspaceWidths };
}
