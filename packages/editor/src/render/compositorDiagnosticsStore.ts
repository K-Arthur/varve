/**
 * Non-blocking compositor diagnostics for StatusBar (useSyncExternalStore).
 */
import type { CompositorDiagnostics } from '@varve/compositor';

let snapshot: CompositorDiagnostics | null = null;
const listeners = new Set<() => void>();

export function setCompositorDiagnostics(next: CompositorDiagnostics | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeCompositorDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCompositorDiagnosticsSnapshot(): CompositorDiagnostics | null {
  return snapshot;
}
