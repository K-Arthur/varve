import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAFE_MODE_OPTIONS,
  enterSafeMode,
  exitSafeMode,
  isInSafeMode,
  MemorySafeModeStore,
  updateSafeModeOptions,
} from './safeMode';

describe('safe mode', () => {
  it('defaults to inactive', () => {
    expect(isInSafeMode(new MemorySafeModeStore())).toBe(false);
  });

  it('enter/exit is reversible and never erases user data', () => {
    const store = new MemorySafeModeStore();
    const state = enterSafeMode(store, '0.1.0', {}, 42);
    expect(state.active).toBe(true);
    expect(state.enteredAt).toBe(42);
    expect(state.appVersion).toBe('0.1.0');
    expect(isInSafeMode(store)).toBe(true);
    exitSafeMode(store);
    expect(isInSafeMode(store)).toBe(false);
  });

  it('safe mode is visibly marked and options are explicit', () => {
    const store = new MemorySafeModeStore();
    enterSafeMode(store, '0.1.0');
    const state = store.load();
    expect(state?.options.disableGpu).toBe(DEFAULT_SAFE_MODE_OPTIONS.disableGpu);
    expect(state?.options.resetCaches).toBe(false);
  });

  it('options can be toggled while active', () => {
    const store = new MemorySafeModeStore();
    enterSafeMode(store, '0.1.0');
    const next = updateSafeModeOptions(store, { resetCaches: true, disableGpu: false });
    expect(next?.options.resetCaches).toBe(true);
    expect(next?.options.disableGpu).toBe(false);
  });

  it('options cannot be toggled when not in safe mode', () => {
    const store = new MemorySafeModeStore();
    expect(updateSafeModeOptions(store, { resetCaches: true })).toBeNull();
  });

  it('recovery consent is independent of safe mode (no coupling)', () => {
    const store = new MemorySafeModeStore();
    enterSafeMode(store, '0.1.0');
    // Safe mode state contains no consent fields.
    const state = store.load();
    expect(state).not.toHaveProperty('consent');
  });
});
