import type { WorkspaceMode } from './workspaceTypes';

const WORKSPACE_RESET_EVENT = 'varve:workspace-reset';

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
