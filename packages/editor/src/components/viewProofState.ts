import { useSyncExternalStore } from 'react';

export interface ViewProofState {
  grayscale: boolean;
  mirror: boolean;
}

const DEFAULT_VIEW_PROOF_STATE: Readonly<ViewProofState> = Object.freeze({
  grayscale: false,
  mirror: false,
});

let viewProofState: Readonly<ViewProofState> = DEFAULT_VIEW_PROOF_STATE;
const listeners = new Set<() => void>();

export function getViewProofState(): Readonly<ViewProofState> {
  return viewProofState;
}

export function subscribeToViewProofState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setViewProofState(patch: Partial<ViewProofState>): void {
  const next = { ...viewProofState, ...patch };
  if (next.grayscale === viewProofState.grayscale && next.mirror === viewProofState.mirror) return;
  viewProofState = Object.freeze(next);
  for (const listener of listeners) listener();
}

export function resetViewProofState(): void {
  setViewProofState({ grayscale: false, mirror: false });
}

export function useViewProofState(): Readonly<ViewProofState> {
  return useSyncExternalStore(subscribeToViewProofState, getViewProofState, getViewProofState);
}
