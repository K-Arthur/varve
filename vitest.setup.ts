/**
 * Vitest browser API shims for jsdom-only tests.
 *
 * Research basis: jsdom intentionally omits CanvasRenderingContext2D unless the
 * optional native canvas package is installed; shell tests only need a no-op
 * target so React effects can mount without noisy environment errors.
 */
import { vi } from 'vitest';

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(contextId: string) {
      if (contextId !== '2d') return null;

      const context: Partial<CanvasRenderingContext2D> = {
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
      };

      return context as CanvasRenderingContext2D;
    },
  });
}
