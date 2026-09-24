import type { LifecycleMarker, TerminationCoordinator } from './coordinator';

/**
 * Complete the browser's clean-session boundary when a tab is actually being
 * discarded and there is no unresolved document or termination transaction.
 * A back-forward-cache transition keeps the page alive, and an active/dirty
 * session must stay marked unclean so recovery remains available.
 */
export function handlePageHideBoundary(
  persisted: boolean,
  coordinator: Pick<TerminationCoordinator, 'bestEffortFlush' | 'shouldWarnOnUnload'> | null,
  marker: Pick<LifecycleMarker, 'markClean'>,
): void {
  if (!coordinator) return;
  coordinator.bestEffortFlush();
  if (!persisted && !coordinator.shouldWarnOnUnload()) marker.markClean();
}
