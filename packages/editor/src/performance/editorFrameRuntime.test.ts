import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
  resetEditorFrameRuntimeForTests,
} from './editorFrameRuntime';

describe('editor frame runtime', () => {
  afterEach(() => {
    resetEditorFrameRuntimeForTests();
    vi.unstubAllGlobals();
  });

  it('coordinates unrelated consumers through one RAF and preserves lane priority', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const order: string[] = [];

    requestEditorFrame(createEditorFrameKey('motion'), 'canvas', () => order.push('motion'));
    requestEditorFrame(createEditorFrameKey('pencil'), 'input', () => order.push('pencil'));

    expect(callbacks.size).toBe(1);
    callbacks.values().next().value?.(16);
    expect(order).toEqual(['pencil', 'motion']);
  });

  it('supports keyed cancellation without cancelling other consumers', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const order: string[] = [];
    requestEditorFrame('cancelled', 'input', () => order.push('cancelled'));
    requestEditorFrame('retained', 'canvas', () => order.push('retained'));

    expect(cancelEditorFrame('cancelled')).toBe(true);
    callbacks.get(1)?.(16);
    expect(order).toEqual(['retained']);
  });

  it('ignores late requests after the Window has been torn down', () => {
    const callback = vi.fn();
    vi.stubGlobal('window', undefined);

    requestEditorFrame('late-render', 'canvas', callback);

    expect(callback).not.toHaveBeenCalled();
  });
});
