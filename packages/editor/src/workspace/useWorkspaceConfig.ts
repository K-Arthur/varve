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
  /** Comic profiles opt Draw into publishing-page presentation without a new mode. */
  workflowProfile?: 'comic-print' | 'manga' | 'webtoon-vertical';
  /**
   * Whether the user explicitly customized the Page Navigator visibility for
   * this mode. The built-in Draw layout hides it; an explicit choice always
   * wins, but an untouched default must not hide a comic document's own pages.
   */
  pagePanelUserControlled?: boolean;
}): PageSurfaceVisibility {
  const hasPages = Number.isFinite(input.pageCount) && input.pageCount > 0;
  const isDesign = input.mode === 'design';
  const isPrint = input.mode === 'print';
  const isComicDrawing = input.mode === 'drawing' && Boolean(input.workflowProfile);
  const pagePanelRevealed =
    isComicDrawing && !input.pagePanelUserControlled ? true : input.pagePanelVisible;
  const showPagesPanel = pagePanelRevealed && (isDesign || isPrint || isComicDrawing);
  return {
    renderPageSurfaces: (isPrint || isComicDrawing) && hasPages,
    showPagesPanel,
    showPageNavigation: pagePanelRevealed && (isPrint || isComicDrawing) && hasPages,
    showPrintGeometry: isPrint && hasPages,
  };
}

/**
 * Whether the user has explicitly customized the Page Navigator panel for a
 * mode. Callers combine this with `resolvePageSurfaceVisibility` so a comic
 * document's pages are disclosed in Draw without overriding an explicit
 * hide/show preference.
 */
export function isPagePanelUserControlled(mode: WorkspaceMode): boolean {
  return getWorkspacePreferences()[mode]?.panelOverrides?.pagenav !== undefined;
}

export function useEffectiveWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  const [prefs, setPrefs] = useState(getWorkspacePreferences);
  useEffect(() => subscribeWorkspacePreferences(() => setPrefs(getWorkspacePreferences())), []);
  return getEffectiveWorkspaceConfig(mode, prefs);
}

/**
 * Reactive per-mode customization flags. Returns a map from mode → boolean
 * so the workspace switcher can show a "customized" dot without each tab subscribing
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
