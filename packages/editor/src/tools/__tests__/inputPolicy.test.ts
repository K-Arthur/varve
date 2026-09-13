import { describe, expect, it } from 'vitest';
import {
  beginPointerContact,
  createPointerOwnershipState,
  endPointerContact,
  getPointerContact,
  isNavigationPointer,
  isToolPointer,
  resetPointerOwnership,
  updatePointerContact,
} from '../inputPolicy';

const start = (pointerId: number, pointerType: string, x = pointerId, y = pointerId) => ({
  pointerId,
  pointerType,
  clientX: x,
  clientY: y,
});

describe('pointer ownership policy', () => {
  it('resolves a provisional one-finger drawing contact when a second finger arrives', () => {
    const state = createPointerOwnershipState();
    expect(beginPointerContact(state, start(1, 'touch'), 'draw')).toMatchObject({
      role: 'tool',
      cancelPointerId: null,
    });

    const second = beginPointerContact(state, start(2, 'touch'), 'draw');
    expect(second).toMatchObject({ role: 'navigation', cancelPointerId: 1 });
    expect(isToolPointer(state, 1)).toBe(false);
    expect(isNavigationPointer(state, 1)).toBe(true);
    expect(isNavigationPointer(state, 2)).toBe(true);
    expect(getPointerContact(state, 1)?.requiresFreshContact).toBe(true);
  });

  it('requires a fresh contact after the pinch set returns to zero', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(1, 'touch'), 'draw');
    beginPointerContact(state, start(2, 'touch'), 'draw');
    endPointerContact(state, 2);
    const remaining = getPointerContact(state, 1);
    expect(remaining?.role).toBe('navigation');
    expect(remaining?.requiresFreshContact).toBe(true);
    endPointerContact(state, 1);

    expect(beginPointerContact(state, start(3, 'touch'), 'draw').role).toBe('tool');
  });

  it('keeps additional contacts in navigation until the pinch set is gone', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(1, 'touch'), 'draw');
    beginPointerContact(state, start(2, 'touch'), 'draw');

    const third = beginPointerContact(state, start(3, 'touch'), 'draw');
    expect(third.role).toBe('navigation');
    expect(isToolPointer(state, 3)).toBe(false);
  });

  it('does not let a compatibility mouse contact steal a touch navigation set', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(1, 'touch'), 'draw');
    beginPointerContact(state, start(2, 'touch'), 'draw');
    expect(beginPointerContact(state, start(3, 'mouse'), 'draw').role).toBe('ignored');
  });

  it('keeps a finger from cancelling or navigating during an active pen stroke', () => {
    const state = createPointerOwnershipState();
    expect(beginPointerContact(state, start(7, 'pen'), 'draw').role).toBe('tool');
    expect(beginPointerContact(state, start(8, 'touch'), 'draw')).toMatchObject({
      role: 'ignored',
      cancelPointerId: null,
    });
    expect(isToolPointer(state, 7)).toBe(true);
    expect(isNavigationPointer(state, 8)).toBe(false);
  });

  it('makes a replacement pen the only tool owner', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(7, 'pen'), 'draw');
    const replacement = beginPointerContact(state, start(8, 'pen'), 'draw');

    expect(replacement.cancelPointerId).toBe(7);
    expect(isToolPointer(state, 7)).toBe(false);
    expect(getPointerContact(state, 7)?.role).toBe('ignored');
    expect(isToolPointer(state, 8)).toBe(true);
  });

  it('uses one-finger navigation when configured, without creating a tool owner', () => {
    const state = createPointerOwnershipState();
    expect(beginPointerContact(state, start(3, 'touch'), 'navigate').role).toBe('navigation');
    expect(state.toolPointerId).toBeNull();
  });

  it('lets unknown pointer types follow the configured finger policy', () => {
    const drawState = createPointerOwnershipState();
    expect(beginPointerContact(drawState, start(4, 'vendor-stylus'), 'draw').role).toBe('tool');
    const navState = createPointerOwnershipState();
    expect(beginPointerContact(navState, start(4, ''), 'navigate').role).toBe('navigation');
  });

  it('replaces stale state on pointer-id reuse and preserves movement deltas', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(9, 'touch', 10, 20), 'draw');
    endPointerContact(state, 9);
    beginPointerContact(state, start(9, 'pen', 40, 50), 'draw');
    expect(getPointerContact(state, 9)?.pointerType).toBe('pen');
    expect(updatePointerContact(state, 9, 45, 53)).toMatchObject({ dx: 5, dy: 3 });
  });

  it('cleans every owner on reset', () => {
    const state = createPointerOwnershipState();
    beginPointerContact(state, start(1, 'pen'), 'draw');
    resetPointerOwnership(state);
    expect(state.contacts.size).toBe(0);
    expect(state.toolPointerId).toBeNull();
    expect(state.penPointerId).toBeNull();
  });
});
