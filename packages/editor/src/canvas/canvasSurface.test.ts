// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { screenToWorld, worldToScreen } from '@varve/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasBackingSize,
  preserveCameraAnchorOnResize,
  readCanvasGeometry,
  resizeCanvasBackingStore,
  subscribeToCanvasContextLifecycle,
  subscribeToDevicePixelRatio,
  subscribeToSystemResume,
  useCanvasGeometry,
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

  it('resubscribes when the host replaces the canvas element', () => {
    const makeCanvas = (left: number, width: number) => {
      const canvas = document.createElement('canvas');
      Object.defineProperties(canvas, {
        clientWidth: { configurable: true, value: width },
        clientHeight: { configurable: true, value: 360 },
      });
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left,
        top: 80,
        width,
        height: 360,
        right: left + width,
        bottom: 440,
        x: left,
        y: 80,
        toJSON: () => ({}),
      });
      return canvas;
    };
    const canvasRef = { current: makeCanvas(120, 640) };
    const { result, rerender, unmount } = renderHook(
      ({ revision }) => useCanvasGeometry(canvasRef, undefined, revision),
      { initialProps: { revision: 0 } },
    );

    expect(result.current.canvasSize).toEqual({ width: 640, height: 360 });
    canvasRef.current = makeCanvas(24, 480);
    rerender({ revision: 1 });

    expect(result.current.canvasSize).toEqual({ width: 480, height: 360 });
    expect(result.current.canvasRectRef.current).toEqual({ left: 24, top: 80 });
    unmount();
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

describe('synchronous geometry refresh', () => {
  function measuredCanvas(left: number) {
    const canvas = document.createElement('canvas');
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 832 },
      clientHeight: { configurable: true, value: 722.484375 },
    });
    const rect = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left,
      top: 122.71875,
      width: 832,
      height: 722.484375,
      right: left + 832,
      bottom: 845.203125,
      x: left,
      y: 122.71875,
      toJSON: () => ({}),
    });
    return { canvas, rect };
  }

  it('does not report unchanged geometry as a resize', () => {
    // An unchanged measurement used to re-run the anchor math, whose
    // floating-point residue committed a new camera on every pointer sample.
    const { canvas } = measuredCanvas(288);
    const onGeometryChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useCanvasGeometry({ current: canvas }, onGeometryChange),
    );
    result.current.refreshCanvasRect();
    result.current.refreshCanvasRect();
    expect(onGeometryChange).not.toHaveBeenCalled();

    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 900 });
    result.current.refreshCanvasRect();
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('skips pointer-move layout reads unless observed geometry is dirty during a gesture', () => {
    const { canvas, rect } = measuredCanvas(288);
    const { result, unmount } = renderHook(() => useCanvasGeometry({ current: canvas }));
    rect.mockClear();
    result.current.refreshCanvasRectForEvent({ type: 'pointermove' });
    expect(rect).not.toHaveBeenCalled();
    result.current.refreshCanvasRectForEvent({ type: 'pointerdown' });
    result.current.refreshCanvasRectForEvent({ type: 'keydown' });
    expect(rect).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('refreshes observed geometry at the current pointer during an active drag', () => {
    const { canvas, rect } = measuredCanvas(288);
    const onGeometryChange = vi.fn();
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useCanvasGeometry({ current: canvas }, onGeometryChange),
    );

    result.current.viewportAnchorRef.current = { clientX: 500, clientY: 300 };
    rect.mockReturnValue({
      left: 240,
      top: 140,
      width: 760,
      height: 650,
      right: 1000,
      bottom: 790,
      x: 240,
      y: 140,
      toJSON: () => ({}),
    });
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 650 },
    });
    window.dispatchEvent(new Event('resize'));
    result.current.refreshCanvasRectForEvent({
      type: 'pointermove',
      clientX: 520,
      clientY: 315,
    });

    expect(onGeometryChange).toHaveBeenCalledWith(
      { left: 288, top: 122.71875, width: 832, height: 722.484375 },
      { left: 240, top: 140, width: 760, height: 650 },
      { clientX: 520, clientY: 315 },
    );
    expect(result.current.canvasRectRef.current).toEqual({ left: 240, top: 140 });
    expect(requestFrame).toHaveBeenCalledOnce();
    unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});

describe('system resume detection', () => {
  afterEach(() => {
    // Tests shadow the jsdom prototype getter with an own property; removing
    // it restores the default 'visible' for later suites.
    delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
  });

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  }

  function setup(options: { heartbeatMs?: number; resumeGapMs?: number } = {}) {
    const onResume = vi.fn();
    let now = 1_000_000;
    const beats: Array<() => void> = [];
    const winListeners = new Map<string, (event: Event) => void>();
    const win = {
      document,
      addEventListener: vi.fn((type: string, fn: (event: Event) => void) => {
        winListeners.set(type, fn);
      }),
      removeEventListener: vi.fn((type: string) => {
        winListeners.delete(type);
      }),
      setInterval: vi.fn((cb: () => void) => {
        beats.push(cb);
        return beats.length;
      }),
      clearInterval: vi.fn(),
    } as unknown as Window;
    const unsubscribe = subscribeToSystemResume(onResume, {
      win,
      doc: document,
      now: () => now,
      ...options,
    });
    return {
      onResume,
      unsubscribe,
      win,
      beats,
      /** Advance the wall clock and deliver the heartbeat tick. */
      tick(ms: number) {
        now += ms;
        for (const beat of beats) beat();
      },
      winHandler(type: string) {
        return winListeners.get(type);
      },
    };
  }

  it('fires on back/forward-cache restore but not on an ordinary pageshow', () => {
    setVisibility('visible');
    const harness = setup();
    harness.winHandler('pageshow')?.({ persisted: false } as unknown as Event);
    expect(harness.onResume).not.toHaveBeenCalled();
    harness.winHandler('pageshow')?.({ persisted: true } as unknown as Event);
    expect(harness.onResume).toHaveBeenCalledOnce();
    harness.unsubscribe();
    expect(harness.win.clearInterval).toHaveBeenCalled();
    expect(harness.win.removeEventListener).toHaveBeenCalledWith('pageshow', expect.any(Function));
  });

  it('fires on the Page Lifecycle resume event', () => {
    setVisibility('visible');
    const harness = setup();
    document.dispatchEvent(new Event('resume'));
    expect(harness.onResume).toHaveBeenCalledOnce();
    harness.unsubscribe();
    document.dispatchEvent(new Event('resume'));
    expect(harness.onResume).toHaveBeenCalledOnce();
  });

  it('treats a long visible-page timer gap as a suspend/resume cycle', () => {
    setVisibility('visible');
    const harness = setup();
    expect(harness.beats).toHaveLength(1);
    harness.tick(15_000);
    harness.tick(15_000);
    expect(harness.onResume).not.toHaveBeenCalled();
    // Sleep: the next heartbeat arrives far later than its period.
    harness.tick(120_000);
    expect(harness.onResume).toHaveBeenCalledOnce();
    harness.unsubscribe();
  });

  it('parks a gap observed while hidden and delivers it once on visible', () => {
    setVisibility('hidden');
    const harness = setup();
    harness.tick(120_000);
    expect(harness.onResume).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(harness.onResume).toHaveBeenCalledOnce();
    // An ordinary tab switch after the parked resume must not redraw again.
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(harness.onResume).toHaveBeenCalledOnce();
    harness.unsubscribe();
  });

  it('ignores throttled background ticks without a suspend gap', () => {
    setVisibility('hidden');
    const harness = setup();
    harness.tick(10_000);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(harness.onResume).not.toHaveBeenCalled();
    harness.unsubscribe();
  });

  it('uses a 15 s heartbeat and 45 s suspend threshold by default', () => {
    setVisibility('visible');
    const harness = setup();
    expect(harness.win.setInterval).toHaveBeenCalledWith(expect.any(Function), 15_000);
    harness.tick(44_999);
    expect(harness.onResume).not.toHaveBeenCalled();
    harness.tick(45_000);
    expect(harness.onResume).toHaveBeenCalledOnce();
    harness.unsubscribe();
  });
});
