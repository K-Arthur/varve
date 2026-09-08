// @vitest-environment jsdom

import { screenToWorld, worldToScreen } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  canvasBackingSize,
  preserveCameraAnchorOnResize,
  readCanvasGeometry,
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

  it('reads position and drawable CSS size together', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 360 },
    });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 120,
      top: 80,
      width: 640,
      height: 360,
      right: 760,
      bottom: 440,
      x: 120,
      y: 80,
      toJSON: () => ({}),
    });
    expect(readCanvasGeometry(canvas)).toEqual({ left: 120, top: 80, width: 640, height: 360 });
  });

  it('preserves the viewport-centre world anchor through a rotated resize', () => {
    const camera = { pan: { x: 37, y: -22 }, zoom: 1.75, rotation: 0.31 };
    const previous = { left: 100, top: 50, width: 800, height: 600 };
    const next = { left: 100, top: 50, width: 1100, height: 500 };
    const adjusted = preserveCameraAnchorOnResize(camera, previous, next);
    const center = screenToWorld(camera, previous.width / 2, previous.height / 2, {
      width: previous.width,
      height: previous.height,
    });
    const projected = worldToScreen(adjusted, center[0], center[1], {
      width: next.width,
      height: next.height,
    });
    expect(projected[0]).toBeCloseTo(next.width / 2, 8);
    expect(projected[1]).toBeCloseTo(next.height / 2, 8);
  });

  it('preserves an active browser anchor while the canvas also moves', () => {
    const camera = { pan: { x: -44, y: 18 }, zoom: 2.2, rotation: -0.42 };
    const previous = { left: 100, top: 50, width: 800, height: 600 };
    const next = { left: 140, top: 90, width: 960, height: 520 };
    const anchor = { clientX: 430, clientY: 280 };
    const adjusted = preserveCameraAnchorOnResize(camera, previous, next, anchor);
    const world = screenToWorld(
      camera,
      anchor.clientX - previous.left,
      anchor.clientY - previous.top,
      { width: previous.width, height: previous.height },
    );
    const projected = worldToScreen(adjusted, world[0], world[1], {
      width: next.width,
      height: next.height,
    });
    expect(projected[0]).toBeCloseTo(anchor.clientX - next.left, 8);
    expect(projected[1]).toBeCloseTo(anchor.clientY - next.top, 8);
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
