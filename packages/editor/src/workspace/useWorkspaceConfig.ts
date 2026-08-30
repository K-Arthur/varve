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
  /** Whether publishing page surfaces are the active canvas document view. */
  renderPageSurfaces: boolean;
  /** Whether the page/surface management panel should be mounted. */
  showPagesPanel: boolean;
  /** Whether the compact publishing-page navigator should be mounted. */
  showPageNavigation: boolean;
  /** Whether print-only geometry controls have a page to act on. */
  showPrintGeometry: boolean;
}

/**
 * Resolve publishing-page UI disclosure without filtering document semantics.
 *
 * A panel preference can hide management controls, but workspace mode must
 * never hide ownership, persistence, or explicit commands. Design workspace
 * exposes Design Canvases; Print exposes Publishing Pages. This boundary is
 * intentional: a Design Canvas is an unbounded exploratory surface, while a
 * Publishing Page owns trim, order, and print/export geometry.
 */
export function resolvePageSurfaceVisibility(input: {
  mode: WorkspaceMode;
  pageCount: number;
  pagePanelVisible: boolean;
}): PageSurfaceVisibility {
  const hasPages = Number.isFinite(input.pageCount) && input.pageCount > 0;
  const isDesign = input.mode === 'design';
  const isPrint = input.mode === 'print';
  const showPagesPanel = input.pagePanelVisible && (isDesign || isPrint);
  return {
    renderPageSurfaces: isPrint && hasPages,
    showPagesPanel,
    showPageNavigation: input.pagePanelVisible && isPrint && hasPages,
    showPrintGeometry: isPrint && hasPages,
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
