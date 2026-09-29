// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyKeyboardInsetToDocument,
  computeKeyboardInset,
  KEYBOARD_INSET_PROPERTY,
  type KeyboardInset,
  readKeyboardInsetSignals,
  subscribeToKeyboardInset,
  VIRTUAL_KEYBOARD_HEIGHT_PROPERTY,
  VIRTUAL_KEYBOARD_WIDTH_PROPERTY,
  VIRTUAL_KEYBOARD_X_PROPERTY,
  VIRTUAL_KEYBOARD_Y_PROPERTY,
  VISUAL_VIEWPORT_HEIGHT_PROPERTY,
  VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY,
  VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY,
} from '../keyboardInset';

const BASE_SIGNALS = {
  layoutViewportWidth: 1200,
  layoutViewportHeight: 800,
  visualViewportWidth: 1200,
  visualViewportHeight: 800,
  visualViewportOffsetTop: 0,
  visualViewportOffsetLeft: 0,
  visualViewportScale: 1,
  keyboardBoundingRect: null,
};

describe('computeKeyboardInset', () => {
  it('reports no keyboard when no signal is present', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportWidth: null,
      visualViewportHeight: null,
      visualViewportOffsetTop: null,
      visualViewportOffsetLeft: null,
      visualViewportScale: null,
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.isKeyboardLikelyOpen).toBe(false);
    expect(inset.visualViewportHeight).toBe(800);
  });

  it('prefers the reported virtual-keyboard bounding rect', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      keyboardBoundingRect: { x: 0, y: 488, width: 1200, height: 312 },
      // The viewport remains full-height, so the reported docked keyboard
      // still intersects its bottom 312 pixels.
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

  it('does not subtract a docked keyboard twice when the visible viewport ends at it', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportHeight: 500,
      keyboardBoundingRect: { x: 0, y: 500, width: 1200, height: 300 },
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.isKeyboardLikelyOpen).toBe(true);
    expect(inset.isFloatingKeyboard).toBe(false);
  });

  it('reports a floating keyboard rectangle without reserving the full bottom edge', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      keyboardBoundingRect: { x: 240, y: 410, width: 720, height: 280 },
    });
    expect(inset.keyboardHeight).toBe(0);
    expect(inset.isKeyboardLikelyOpen).toBe(true);
    expect(inset.isFloatingKeyboard).toBe(true);
    expect(inset.keyboardBounds).toEqual({ x: 240, y: 410, width: 720, height: 280 });
  });

  it('uses horizontal visual-viewport intersection for docked keyboards', () => {
    const inset = computeKeyboardInset({
      ...BASE_SIGNALS,
      visualViewportWidth: 500,
      visualViewportOffsetLeft: 700,
      keyboardBoundingRect: { x: 0, y: 500, width: 1200, height: 300 },
    });
    expect(inset.visualViewportOffsetLeft).toBe(700);
    expect(inset.keyboardHeight).toBe(300);
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
      keyboardBoundingRect: { x: 0, y: 0, width: 1200, height: 2000 },
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
  offsetLeft: number;
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
    offsetLeft: 0,
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
  const initialKeyboardHeight = overrides.virtualKeyboardHeight ?? 0;
  const virtualKeyboardRect = {
    height: initialKeyboardHeight,
    width: 1200,
    x: 0,
    y: 800 - initialKeyboardHeight,
    top: 800 - initialKeyboardHeight,
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
    expect(signals.keyboardBoundingRect).toEqual({
      x: 0,
      y: 500,
      width: 1200,
      height: 300,
    });
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
    expect(signals.keyboardBoundingRect).toBeNull();
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
    fake.virtualKeyboardRect.y = 500;
    fake.virtualKeyboardRect.top = 500;
    fake.emitVirtualKeyboard();
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].keyboardHeight).toBe(300);
    expect(onChange.mock.calls[0]?.[0].isKeyboardLikelyOpen).toBe(true);

    fake.virtualKeyboardRect.x = 200;
    fake.virtualKeyboardRect.width = 800;
    fake.virtualKeyboardRect.left = 200;
    fake.virtualKeyboardRect.right = 1000;
    fake.emitVirtualKeyboard();
    fake.flushFrames();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1]?.[0].keyboardHeight).toBe(0);
    expect(onChange.mock.calls[1]?.[0].isFloatingKeyboard).toBe(true);
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
  it('writes and replaces viewport and keyboard geometry', () => {
    const inset: KeyboardInset = {
      keyboardHeight: 288,
      visualViewportHeight: 512,
      visualViewportOffsetTop: 0,
      visualViewportOffsetLeft: 0,
      layoutViewportHeight: 800,
      keyboardBounds: { x: 0, y: 512, width: 1200, height: 288 },
      isFloatingKeyboard: false,
      isKeyboardLikelyOpen: true,
    };
    applyKeyboardInsetToDocument(document, inset);
    const root = document.documentElement;
    expect(root.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('288px');
    expect(root.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_PROPERTY)).toBe('512px');
    expect(root.style.getPropertyValue(VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY)).toBe('0px');
    expect(root.style.getPropertyValue(VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY)).toBe('0px');
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_X_PROPERTY)).toBe('0px');
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_Y_PROPERTY)).toBe('512px');
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_WIDTH_PROPERTY)).toBe('1200px');
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_HEIGHT_PROPERTY)).toBe('288px');
    expect(root.dataset.virtualKeyboardOpen).toBe('true');
    expect(root.dataset.virtualKeyboardFloating).toBe('false');

    applyKeyboardInsetToDocument(document, computeKeyboardInset(BASE_SIGNALS));
    expect(root.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)).toBe('0px');
    expect(root.style.getPropertyValue(VIRTUAL_KEYBOARD_WIDTH_PROPERTY)).toBe('0px');
    expect(root.dataset.virtualKeyboardOpen).toBe('false');
    for (const property of [
      KEYBOARD_INSET_PROPERTY,
      VISUAL_VIEWPORT_HEIGHT_PROPERTY,
      VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY,
      VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY,
      VIRTUAL_KEYBOARD_X_PROPERTY,
      VIRTUAL_KEYBOARD_Y_PROPERTY,
      VIRTUAL_KEYBOARD_WIDTH_PROPERTY,
      VIRTUAL_KEYBOARD_HEIGHT_PROPERTY,
    ]) {
      root.style.removeProperty(property);
    }
    delete root.dataset.virtualKeyboardOpen;
    delete root.dataset.virtualKeyboardFloating;
  });

  it('does not throw for a document without documentElement styles', () => {
    const bare = {} as Document;
    expect(() =>
      applyKeyboardInsetToDocument(bare, {
        keyboardHeight: 0,
        visualViewportHeight: 0,
        visualViewportOffsetTop: 0,
        visualViewportOffsetLeft: 0,
        layoutViewportHeight: 0,
        keyboardBounds: null,
        isFloatingKeyboard: false,
        isKeyboardLikelyOpen: false,
      }),
    ).not.toThrow();
  });
});
