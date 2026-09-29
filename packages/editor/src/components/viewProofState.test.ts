import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getViewProofState,
  resetViewProofState,
  setViewProofState,
  subscribeToViewProofState,
} from './viewProofState';

describe('view-proof session state', () => {
  beforeEach(() => resetViewProofState());

  it('starts with both review views disabled', () => {
    expect(getViewProofState()).toEqual({ grayscale: false, mirror: false });
  });

  it('updates one check without clearing the other and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToViewProofState(listener);

    setViewProofState({ grayscale: true });
    setViewProofState({ mirror: true });

    expect(getViewProofState()).toEqual({ grayscale: true, mirror: true });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('does not notify subscribers for an unchanged setting', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToViewProofState(listener);

    setViewProofState({ grayscale: false });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
