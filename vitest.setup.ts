/**
 * Vitest browser API shims for jsdom-only tests.
 *
 * Research basis: jsdom intentionally omits CanvasRenderingContext2D unless the
 * optional native canvas package is installed; shell tests only need a no-op
 * target so React effects can mount without noisy environment errors.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(contextId: string) {
      if (contextId !== '2d') return null;

      (this as HTMLCanvasElement).toDataURL = vi.fn(() => 'data:image/png;base64,test');

      const ctx: Partial<CanvasRenderingContext2D> = {
        canvas: this as HTMLCanvasElement,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        font: '',
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        transform: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        ellipse: vi.fn(),
        arc: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
        fillText: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        clearRect: vi.fn(),
        createImageData: vi.fn(),
        putImageData: vi.fn(),
        getImageData: vi.fn(),
      };

      return ctx as CanvasRenderingContext2D;
    },
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

// jsdom does not implement HTMLDialogElement
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
}
