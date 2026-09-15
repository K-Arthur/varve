// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyKeyboardInsetToDocument,
  computeKeyboardInset,
  KEYBOARD_INSET_PROPERTY,
  type KeyboardInset,
  readKeyboardInsetSignals,
  subscribeToKeyboardInset,
  VISUAL_VIEWPORT_HEIGHT_PROPERTY,
  VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY,
} from '../keyboardInset';

const BASE_SIGNALS = {
  layoutViewportWidth: 1200,
  layoutViewportHeight: 800,
  visualViewportWidth: 1200,
  visualViewportHeight: 800,
  visualViewportOffsetTop: 0,
  visualViewportScale: 1,
  keyboardBoundingRectHeight: null,
};

describe('computeKeyboardInset', () => {
  it('reports no keyboard when no signal is present', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportWidth: null,
      visualViewportHeight: null,
      visualViewportOffsetTop: null,
      visualViewportScale: null,
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.isKeyboardLikelyOpen).toBe(false);
    expect(inset.visualViewportHeight).toBe(800);
  });

  it('prefers the reported virtual-keyboard bounding rect', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      keyboardBoundingRectHeight: 312,
      // Even with a contradictory visual viewport, the explicit keyboard
      // measurement wins.
      visualViewportHeight: 800,
    });
    expect(inset.keyboardHeight).toBe(312);
    expect(inset.isKeyboardLikelyOpen).toBe(true);
  });

  it('derives the inset from a resized visual viewport', () => {
    const inset = computeKeyboardInset({ ...BASE_SIGNALS, visualViewportHeight: 480 });
    expect(inset.keyboardHeight).toBe(320);
    expect(inset.isKeyboardLikelyOpen).toBe(true);
  });

  it('accounts for a scrolled visual viewport offset', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportHeight: 500,
      visualViewportOffsetTop: 100,
    });
    expect(inset.keyboardHeight).toBe(200);
  });

  it('does not treat pinch zoom as a keyboard', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportHeight: 400,
      visualViewportScale: 1.75,
      visualViewportWidth: 685,
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.visualViewportHeight).toBe(400);
    expect(inset.isKeyboardLikelyOpen).toBe(false);
  });

  it('does not treat a width-collapsing preview pane as a keyboard', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportHeight: 520,
      visualViewportWidth: 600,
    });
    expect(inset.keyboardHeight).toBe(0);
  });

  it('ignores sub-pixel noise', () => {
    const inset = computeKeyboardInset({ ...BASE_SIGNALS, visualViewportHeight: 799.6 });
    expect(inset.keyboardHeight).toBe(0);
  });

  it('clamps the inset to the layout viewport height', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      keyboardBoundingRectHeight: 2000,
    });
    expect(inset.keyboardHeight).toBe(800);
  });

  it('keeps published visual viewport metrics even when no keyboard is detected', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportHeight: 600,
      visualViewportOffsetTop: 25,
      visualViewportScale: 2,
      visualViewportWidth: 500,
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.visualViewportHeight).toBe(600);
    expect(inset.visualViewportOffsetTop).toBe(25);
  });
});

interface FakeViewport {
  width: number;
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function createFakeWindow(overrides: { virtualKeyboardHeight?: number | null } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const frameQueue: Array<() => void> = [];
  const viewport: FakeViewport = {
    width: 1200,
    height: 800,
    offsetTop: 0,
    scale: 1,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const windowListeners = new Map<string, Set<() => void>>();
  const virtualKeyboardListeners = new Set<() => void>();
  const documentListeners = new Map<string, Set<() => void>>();
  const virtualKeyboardRect = {
    height: overrides.virtualKeyboardHeight ?? 0,
    width: 1200,
    x: 0,
    y: 800,
    top: 800,
    left: 0,
    right: 1200,
    bottom: 800,
    toJSON: () => ({}),
  };
  const fake = {
    innerWidth: 1200,
    innerHeight: 800,
    visualViewport: viewport,
    navigator: {
      virtualKeyboard:
        overrides.virtualKeyboardHeight === undefined
          ? undefined
          : {
              boundingRect: virtualKeyboardRect,
              addEventListener: (type: string, listener: () => void) => {
                if (type === 'geometrychange') virtualKeyboardListeners.add(listener);
              },
              removeEventListener: (type: string, listener: () => void) => {
                if (type === 'geometrychange') virtualKeyboardListeners.delete(listener);
              },
            },
    },
    document: {
      addEventListener(type: string, listener: () => void) {
        const set = documentListeners.get(type) ?? new Set();
        set.add(listener);
        documentListeners.set(type, set);
      },
      removeEventListener(type: string, listener: () => void) {
        documentListeners.get(type)?.delete(listener);
      },
    },
    addEventListener(type: string, listener: () => void) {
      const set = windowListeners.get(type) ?? new Set();
      set.add(listener);
      windowListeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      windowListeners.get(type)?.delete(listener);
    },
    requestAnimationFrame(callback: () => void) {
      frameQueue.push(callback);
      return frameQueue.length;
    },
  };

  const flushFrames = () => {
    const queued = frameQueue.splice(0, frameQueue.length);
    for (const callback of queued) callback();
  };
  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  const emitWindow = (type: string) => {
    for (const listener of windowListeners.get(type) ?? []) listener();
  };
  const emitVirtualKeyboard = () => {
    for (const listener of virtualKeyboardListeners) listener();
  };

  return {
    window: fake as unknown as Window,
    viewport,
    virtualKeyboardRect,
    emit,
    emitWindow,
    emitVirtualKeyboard,
    flushFrames,
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0) +
      [...windowListeners.values()].reduce((sum, set) => sum + set.size, 0) +
      virtualKeyboardListeners.size +
      [...documentListeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe('readKeyboardInsetSignals', () => {
  it('reads layout, visual, and virtual-keyboard signals', () => {
    const { window: fakeWindow, viewport } = createFakeWindow({ virtualKeyboardHeight: 300 });
    viewport.height = 500;
    viewport.offsetTop = 12;
    const signals = readKeyboardInsetSignals(fakeWindow);
    expect(signals.layoutViewportHeight).toBe(800);
    expect(signals.visualViewportHeight).toBe(500);
    expect(signals.visualViewportOffsetTop).toBe(12);
    expect(signals.keyboardBoundingRectHeight).toBe(300);
  });

  it('survives a window without visualViewport or virtualKeyboard', () => {
    const bare = {
      innerWidth: 1024,
      innerHeight: 768,
      navigator: {},
      visualViewport: null,
    } as unknown as Window;
    const signals = readKeyboardInsetSignals(bare);
    expect(signals.visualViewportHeight).toBeNull();
    expect(signals.keyboardBoundingRectHeight).toBeNull();
  });
});

describe('subscribeToKeyboardInset', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
  });

  it('emits the current value synchronously', () => {
    const { window: fakeWindow } = createFakeWindow();
    const onChange = vi.fn<(inset: KeyboardInset) => void>();
    disposers.push(subscribeToKeyboardInset(fakeWindow, onChange));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].keyboardHeight).toBe(0);
  });

  it('emits once per animation frame for a burst of resize events', () => {
    const fake = createFakeWindow();
    const onChange = vi.fn<(inset: KeyboardInset) => void>();
    disposers.push(subscribeToKeyboardInset(fake.window, onChange));
    onChange.mockClear();

    fake.viewport.height = 480;
    fake.emit('resize');
    fake.emit('resize');
    fake.emit('scroll');
    expect(onChange).not.toHaveBeenCalled();
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].keyboardHeight).toBe(320);
  });

  it('emits again when the keyboard geometry changes', () => {
    const fake = createFakeWindow({ virtualKeyboardHeight: 0 });
    const onChange = vi.fn<(inset: KeyboardInset) => void>();
    disposers.push(subscribeToKeyboardInset(fake.window, onChange));
    onChange.mockClear();

    fake.virtualKeyboardRect.height = 300;
    fake.emitVirtualKeyboard();
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].keyboardHeight).toBe(300);
    expect(onChange.mock.calls[0]?.[0].isKeyboardLikelyOpen).toBe(true);
  });

  it('does not re-emit identical values', () => {
    const fake = createFakeWindow();
    const onChange = vi.fn<(inset: KeyboardInset) => void>();
    disposers.push(subscribeToKeyboardInset(fake.window, onChange));
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);

    fake.emitWindow('resize');
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('removes every listener on dispose', () => {
    const fake = createFakeWindow();
    const dispose = subscribeToKeyboardInset(fake.window, () => undefined);
    expect(fake.listenerCount()).toBeGreaterThan(0);
    dispose();
    expect(fake.listenerCount()).toBe(0);
  });
});

describe('applyKeyboardInsetToDocument', () => {
  it('writes the three custom properties and is replaceable', () => {
    const inset: KeyboardInset = {
      keyboardHeight: 288,
      visualViewportHeight: 512,
      visualViewportOffsetTop: 0,
      layoutViewportHeight: 800,
      isKeyboardLikelyOpen: true,
    };
    applyKeyboardInsetToDocument(document, inset);
    const root = document.documentElement;
    expect(root.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('288px');
    expect(root.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_PROPERTY)).toBe('512px');
    expect(root.style.getPropertyValue(VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY)).toBe('0px');

    applyKeyboardInsetToDocument(document, { ...inset, keyboardHeight: 0 });
    expect(root.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('0px');
    root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY);
  });

  it('does not throw for a document without documentElement styles', () => {
    const bare = {} as Document;
    expect(() =>
      applyKeyboardInsetToDocument(bare, {
        keyboardHeight: 0,
        visualViewportHeight: 0,
        visualViewportOffsetTop: 0,
        layoutViewportHeight: 0,
        isKeyboardLikelyOpen: false,
      }),
    ).not.toThrow();
  });
});
