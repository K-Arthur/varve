/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { afterFirstVisiblePaint } from './visibleSurface';

function createFrameDriver() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  return {
    requestFrame(callback: FrameRequestCallback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id: number) {
      callbacks.delete(id);
    },
    runNext() {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1](0);
    },
    pending: () => callbacks.size,
  };
}

describe('afterFirstVisiblePaint', () => {
  it('waits for non-zero layout and a subsequent animation frame', () => {
    const frames = createFrameDriver();
    const onVisible = vi.fn();
    const element = document.createElement('div');
    let visible = false;
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () => ({ width: visible ? 640 : 0, height: visible ? 480 : 0 }) as DOMRect,
    );

    afterFirstVisiblePaint('.surface', onVisible, {
      findElement: () => element,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    frames.runNext();
    expect(onVisible).not.toHaveBeenCalled();
    visible = true;
    frames.runNext();
    expect(onVisible).not.toHaveBeenCalled();
    frames.runNext();
    expect(onVisible).toHaveBeenCalledOnce();
  });

  it('requires a canvas backing store before declaring it visible', () => {
    const frames = createFrameDriver();
    const onVisible = vi.fn();
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 640,
      height: 480,
    } as DOMRect);

    afterFirstVisiblePaint('canvas', onVisible, {
      findElement: () => canvas,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.runNext();
    canvas.width = 1280;
    canvas.height = 960;
    frames.runNext();
    frames.runNext();

    expect(onVisible).toHaveBeenCalledOnce();
  });

  it('cancels polling and completion callbacks', () => {
    const frames = createFrameDriver();
    const onVisible = vi.fn();
    const stop = afterFirstVisiblePaint('.missing', onVisible, {
      findElement: () => null,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    expect(frames.pending()).toBe(1);
    stop();
    expect(frames.pending()).toBe(0);
    expect(onVisible).not.toHaveBeenCalled();
  });
});
