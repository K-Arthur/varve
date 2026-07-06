/**
 * Vitest browser API shims for jsdom-only tests.
 */
// Provide IndexedDB for node environment tests (platform/web.ts).
// Guard to avoid conflicts with jsdom's own implementation.
if (typeof globalThis.indexedDB === 'undefined') {
  try {
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
  } catch {
    // fake-indexeddb not available — skip
  }
}

// Polyfill ResizeObserver for jsdom tests that render React components
// with hooks that observe container sizes (e.g., LayersPanel, Shell).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub as any;
}

/**
 * Research basis: jsdom intentionally omits CanvasRenderingContext2D unless the
 * optional native canvas package is installed; shell tests only need a no-op
 * target so React effects can mount without noisy environment errors.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Without `globals: true`, React Testing Library cannot self-register its
// afterEach cleanup — renders would accumulate across tests in a file and
// queries would match stale elements from earlier tests.
afterEach(() => {
  cleanup();
});

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(contextId: string) {
      if (contextId !== '2d') return null;

      (this as HTMLCanvasElement).toDataURL = vi.fn(() => 'data:image/png;base64,test');

      const _pixelStore = new Uint8ClampedArray(8192 * 4);
      const ctx: Partial<CanvasRenderingContext2D> = {
        canvas: this as HTMLCanvasElement,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        font: '',
        textAlign: 'start' as CanvasTextAlign,
        textBaseline: 'alphabetic' as CanvasTextBaseline,
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        transform: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        ellipse: vi.fn(),
        arc: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        rotate: vi.fn(),
        arcTo: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn().mockReturnValue({
          width: 0,
          actualBoundingBoxAscent: 0,
          actualBoundingBoxDescent: 0,
          fontBoundingBoxAscent: 0,
          fontBoundingBoxDescent: 0,
        }),
        translate: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        createImageData: vi.fn((w: number, h: number) => new ImageData(w, h)),
        putImageData: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
          return new ImageData(w, h);
        }),
        drawImage: vi.fn(),
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        filter: 'none',
      };

      return ctx as CanvasRenderingContext2D;
    },
  });
}

// jsdom does not implement ImageData
if (typeof ImageData === 'undefined') {
  class ImageDataMock {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(w: number, h: number, _settings?: { colorSpace?: string }) {
      if (typeof w === 'number') {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      } else {
        const arr = w as unknown as Uint8ClampedArray;
        this.data = arr;
        this.width = h!;
        this.height = (_settings as unknown as number) ?? 1;
      }
    }
  }
  Object.defineProperty(globalThis, 'ImageData', {
    configurable: true,
    value: ImageDataMock as unknown as typeof ImageData,
  });
}

// jsdom does not implement OffscreenCanvas
if (typeof OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return null;
    }
    convertToBlob() {
      return Promise.resolve(new Blob());
    }
  } as unknown as typeof OffscreenCanvas;
}

// jsdom does not implement PointerEvent; node has neither PointerEvent nor MouseEvent
if (
  typeof globalThis.PointerEvent === 'undefined' &&
  typeof globalThis.MouseEvent !== 'undefined'
) {
  class PointerEventMock extends MouseEvent {
    readonly pointerId: number;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    readonly tangentialPressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly twist: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: PointerEventMock as typeof PointerEvent,
  });
}

// jsdom does not implement localStorage
const store = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

// jsdom does not implement sessionStorage
const sessionStore = new Map<string, string>();
const sessionStorageMock: Storage = {
  getItem: (key: string) => sessionStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    sessionStore.set(key, value);
  },
  removeItem: (key: string) => {
    sessionStore.delete(key);
  },
  clear: () => {
    sessionStore.clear();
  },
  get length() {
    return sessionStore.size;
  },
  key: (index: number) => [...sessionStore.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: sessionStorageMock,
});

// jsdom does not implement matchMedia
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom does not implement the popover API
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.showPopover) {
  const popoverState = new WeakMap<HTMLElement, boolean>();

  HTMLElement.prototype.showPopover = vi.fn(function (this: HTMLElement) {
    if (popoverState.get(this)) throw new DOMException('Already showing');
    popoverState.set(this, true);
    this.style.removeProperty('display');
    this.dispatchEvent(new Event('toggle', { bubbles: false }));
  });

  HTMLElement.prototype.hidePopover = vi.fn(function (this: HTMLElement) {
    if (!popoverState.get(this)) throw new DOMException('Already hidden');
    popoverState.set(this, false);
    this.style.display = 'none';
    this.dispatchEvent(new Event('toggle', { bubbles: false }));
  });

  HTMLElement.prototype.togglePopover = vi.fn(function (this: HTMLElement) {
    if (popoverState.get(this)) {
      this.hidePopover();
    } else {
      this.showPopover();
    }
  });
}

// jsdom does not implement HTMLDialogElement
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
}
