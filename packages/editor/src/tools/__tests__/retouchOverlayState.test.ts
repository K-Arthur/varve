import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRetouchOverlaySnapshot,
  patchRetouchOverlay,
  resetRetouchOverlay,
  subscribeRetouchOverlay,
} from '../retouchOverlayState';

describe('retouchOverlayState', () => {
  afterEach(() => {
    resetRetouchOverlay();
  });

  it('publishes the active tool and source anchor', () => {
    patchRetouchOverlay({
      toolId: 'cloneStamp',
      cloneSourceWorld: { x: 12, y: 34 },
    });
    expect(getRetouchOverlaySnapshot()).toMatchObject({
      toolId: 'cloneStamp',
      cloneSourceWorld: { x: 12, y: 34 },
      cloneCursorWorld: null,
    });
  });

  it('notifies subscribers on a real change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRetouchOverlay(listener);
    patchRetouchOverlay({ toolId: 'cloneStamp', cloneSourceWorld: { x: 1, y: 2 } });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    patchRetouchOverlay({ cloneCursorWorld: { x: 3, y: 4 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores value-identical pointer updates', () => {
    const listener = vi.fn();
    subscribeRetouchOverlay(listener);
    patchRetouchOverlay({ cloneCursorWorld: { x: 5, y: 6 } });
    patchRetouchOverlay({ cloneCursorWorld: { x: 5, y: 6 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets every field', () => {
    patchRetouchOverlay({
      toolId: 'healBrush',
      cloneSourceWorld: { x: 1, y: 1 },
      cloneCursorWorld: { x: 2, y: 2 },
    });
    resetRetouchOverlay();
    expect(getRetouchOverlaySnapshot()).toEqual({
      toolId: null,
      cloneSourceWorld: null,
      cloneCursorWorld: null,
    });
  });
});
