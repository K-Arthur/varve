// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  canvasBackingSize,
  resizeCanvasBackingStore,
  subscribeToCanvasContextLifecycle,
  subscribeToDevicePixelRatio,
} from './canvasSurface';

describe('canvas backing store', () => {
  it('rounds fractional CSS-pixel and DPR products exactly once', () => {
    expect(canvasBackingSize(333.3, 1.25)).toBe(417);
    expect(canvasBackingSize(0, 2)).toBe(0);
  });

  it('does not reset canvas state when the rounded backing size is unchanged', () => {
    const canvas = { width: 417, height: 250 };
    expect(resizeCanvasBackingStore(canvas, 333.3, 200, 1.25)).toBe(false);
    expect(canvas).toEqual({ width: 417, height: 250 });
  });

  it('resizes both dimensions atomically when display scale changes', () => {
    const canvas = { width: 400, height: 300 };
    expect(resizeCanvasBackingStore(canvas, 400, 300, 2)).toBe(true);
    expect(canvas).toEqual({ width: 800, height: 600 });
  });

  it('observes window resize when matchMedia is unavailable', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const target = {
      devicePixelRatio: 1.25,
      addEventListener,
      removeEventListener,
    } as unknown as Window;
    const onChange = vi.fn();
    const unsubscribe = subscribeToDevicePixelRatio(onChange, target);
    expect(onChange).toHaveBeenCalledWith(1.25);
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('reports context loss and restoration and removes lifecycle listeners', () => {
    const canvas = document.createElement('canvas');
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const unsubscribe = subscribeToCanvasContextLifecycle(canvas, { onLost, onRestored });
    const lost = new Event('contextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(new Event('contextrestored'));
    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledOnce();
    expect(onRestored).toHaveBeenCalledOnce();
    unsubscribe();
    canvas.dispatchEvent(new Event('contextrestored'));
    expect(onRestored).toHaveBeenCalledOnce();
  });
});
