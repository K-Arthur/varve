/**
 * useEffectiveWorkspaceConfig — reactive view of the effective workspace
 * configuration (built-in config + persisted user overrides).
 *
 * Shell and friends subscribe here so a preference change (panel toggle
 * recorded by the store) re-renders workspace-controlled surfaces without
 * threading the preferences through EditorState.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  isModeCustomized,
  subscribeWorkspacePreferences,
} from './workspaceStore';
import { ALL_WORKSPACE_MODES, type WorkspaceConfig, type WorkspaceMode } from './workspaceTypes';

export interface PageSurfaceVisibility {
  /** Whether publishing page surfaces remain part of the canvas document view. */
  renderPageSurfaces: boolean;
  /** Whether the page-management panel should be mounted. */
  showPagesPanel: boolean;
  /** Whether the compact page navigator should be mounted. */
  showPageNavigation: boolean;
  /** Whether print-only geometry controls have a page to act on. */
  showPrintGeometry: boolean;
}

/**
 * Resolve publishing-page UI disclosure without filtering document semantics.
 *
 * A panel preference can hide management controls, but workspace mode must
 * never hide page rendering, ownership, persistence, or explicit commands.
 * The ordinary canvas and its frames remain available in every workspace;
 * print-only controls are disclosed only when a publishing page exists.
 * Print keeps an empty management panel available so a flat document can be
 * promoted intentionally by the user rather than by an implicit conversion.
 */
export function resolvePageSurfaceVisibility(input: {
  mode: WorkspaceMode;
  pageCount: number;
  pagePanelVisible: boolean;
}): PageSurfaceVisibility {
  const hasPages = Number.isFinite(input.pageCount) && input.pageCount > 0;
  const showPagesPanel = input.pagePanelVisible && (hasPages || input.mode === 'print');
  return {
    renderPageSurfaces: hasPages,
    showPagesPanel,
    showPageNavigation: input.pagePanelVisible && hasPages,
    showPrintGeometry: input.mode === 'print' && hasPages,
  };
}

export function useEffectiveWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return getEffectiveWorkspaceConfig(mode, prefs);
}

/**
 * Reactive per-mode customization flags. Returns a map from mode → boolean
 * so workspace tabs can show a "customized" dot without each tab subscribing
 * independently.
 */
export function useWorkspaceCustomizations(): Record<WorkspaceMode, boolean> {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return useMemo(() => {
    const result = {} as Record<WorkspaceMode, boolean>;
    for (const mode of ALL_WORKSPACE_MODES) {
      result[mode] = isModeCustomized(prefs, mode);
    }
    return result;
  }, [prefs]);
}
