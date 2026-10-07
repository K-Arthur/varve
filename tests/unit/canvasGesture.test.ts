import { describe, expect, it } from 'vitest';
import { assertCanvasGesture } from '../e2e/helpers/canvasGesture';

const box = { x: 280, y: 145, width: 688, height: 600 };

describe('canvas gesture contract', () => {
  it('accepts visible canvas-relative CSS coordinates', () => {
    expect(() => assertCanvasGesture(box, { x: 450, y: 420 }, { x: 550, y: 520 })).not.toThrow();
  });

  it('rejects the former snapping fixture before dispatching pointer events', () => {
    expect(() => assertCanvasGesture(box, { x: 640, y: 500 }, { x: 740, y: 600 })).toThrow(
      /outside artwork bounds 688x600/,
    );
  });

  it.each([null, { ...box, width: 0 }, { ...box, height: Number.NaN }])(
    'rejects missing, collapsed or invalid artwork surfaces without an auxiliary fallback',
    (bounds) => {
      expect(() => assertCanvasGesture(bounds, { x: 50, y: 50 }, { x: 100, y: 100 })).toThrow();
    },
  );

  it('rejects non-finite pointer coordinates', () => {
    expect(() => assertCanvasGesture(box, { x: Number.NaN, y: 50 }, { x: 100, y: 100 })).toThrow(
      /finite CSS pixels/,
    );
  });

  it('allows a documented pointer-captured pan to end outside', () => {
    expect(() =>
      assertCanvasGesture(
        box,
        { x: 400, y: 400 },
        { x: -500, y: -500 },
        'Floating-origin regression deliberately pans beyond the artwork surface.',
      ),
    ).not.toThrow();
  });

  it('still rejects an outside starting point for a documented pan', () => {
    expect(() =>
      assertCanvasGesture(
        box,
        { x: 1040, y: 620 },
        { x: 1180, y: 760 },
        'Intentional long pan regression.',
      ),
    ).toThrow(/outside artwork bounds/);
  });

  it('requires a useful reason for an intentional outside pan', () => {
    expect(() => assertCanvasGesture(box, { x: 50, y: 50 }, { x: -100, y: 100 }, '')).toThrow(
      /explicit reason/,
    );
  });
});
