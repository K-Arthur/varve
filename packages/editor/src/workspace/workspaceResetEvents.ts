import type { PanelId, WorkspaceMode } from './workspaceTypes';

const WORKSPACE_RESET_EVENT = 'varve:workspace-reset';
const WORKSPACE_LAYOUT_APPLIED_EVENT = 'varve:workspace-layout-applied';

export type WorkspaceResetScope = { kind: 'mode'; mode: WorkspaceMode } | { kind: 'all' };

/** Notify live shell services that a workspace preference reset completed. */
export function emitWorkspaceReset(scope: WorkspaceResetScope): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceResetScope>(WORKSPACE_RESET_EVENT, { detail: scope }),
  );
}

/** Subscribe to reset notifications without coupling the store to React. */
export function subscribeWorkspaceReset(
  listener: (scope: WorkspaceResetScope) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleEvent = (event: Event) => {
    const scope = (event as CustomEvent<WorkspaceResetScope>).detail;
    if (scope?.kind === 'all' || (scope?.kind === 'mode' && typeof scope.mode === 'string')) {
      listener(scope);
    }
  };
  window.addEventListener(WORKSPACE_RESET_EVENT, handleEvent);
  return () => window.removeEventListener(WORKSPACE_RESET_EVENT, handleEvent);
}

export interface WorkspaceLayoutAppliedDetail {
  mode: WorkspaceMode;
  /**
   * Panel widths the applied layout specifies. A panel absent from this map
   * intentionally falls back to the mode/global default, because applying a
   * layout replaces the mode's arrangement rather than merging into it.
   */
  panelWidths: Partial<Record<PanelId, number>>;
}

/**
 * Notify live width owners that a named layout was applied. Panel visibility
 * lives in EditorState (projected through the workspace config), but panel
 * widths are owned by the resize hooks; without this event a saved width
 * would only appear after a mode switch or restart.
 */
export function emitWorkspaceLayoutApplied(detail: WorkspaceLayoutAppliedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceLayoutAppliedDetail>(WORKSPACE_LAYOUT_APPLIED_EVENT, {
      detail,
    }),
  );
}

export function subscribeWorkspaceLayoutApplied(
  listener: (detail: WorkspaceLayoutAppliedDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceLayoutAppliedDetail>).detail;
    if (detail && typeof detail.mode === 'string' && detail.panelWidths) listener(detail);
  };
  window.addEventListener(WORKSPACE_LAYOUT_APPLIED_EVENT, handleEvent);
  return () => window.removeEventListener(WORKSPACE_LAYOUT_APPLIED_EVENT, handleEvent);
}
