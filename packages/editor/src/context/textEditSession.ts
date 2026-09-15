/**
 * Module-level flag for the in-canvas text edit session.
 *
 * The session itself is owned by CanvasArea's local state. Two other command
 * surfaces need to know about it — the selection quick bar suppresses itself
 * during editing, and the context bar would otherwise render the same
 * typography controls as the floating text bar. Routing one boolean through
 * the editor context would re-render the whole shell on every session
 * start/stop, so this tiny external store exists instead (same pattern as
 * `tools/retouchOverlayState.ts`).
 *
 * The floating text bar is mounted exactly while the session is active, so it
 * publishes here; consumers subscribe with `useSyncExternalStore`.
 */

let activeNodeId: string | null = null;
const listeners = new Set<() => void>();

export function getTextEditSessionNodeId(): string | null {
  return activeNodeId;
}

export function subscribeTextEditSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishTextEditSession(nodeId: string | null): void {
  if (activeNodeId === nodeId) return;
  activeNodeId = nodeId;
  for (const listener of listeners) listener();
}
