/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMinimapTransform } from './minimapLayout';
import { renderMinimapToCanvas, resolveMinimapColors } from './minimapRenderer';

function emptyScene() {
  return {
    entries: [],
    contentBounds: { x: 0, y: 0, w: 100, h: 100 },
    outliers: [],
    pages: [],
    totalNodes: 0,
  };
}

describe('minimapRenderer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
  });

  it('keeps CSS color tokens intact instead of parsing them as hex', () => {
    const colors = resolveMinimapColors((name, fallback) =>
      name === '--color-interactive-default' ? 'rgb(0 208 198)' : fallback,
    );

    expect(colors.viewportFill).toBe('rgb(0 208 198)');
    expect(colors.viewportStroke).toBe('rgb(0 208 198)');
  });

  it('does not reallocate the backing store when only the camera projection redraws', () => {
    const canvas = document.createElement('canvas');
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    canvas.getContext = vi.fn(() => context);
    let width = 0;
    let height = 0;
    let widthAssignments = 0;
    let heightAssignments = 0;
    Object.defineProperties(canvas, {
      width: {
        configurable: true,
        get: () => width,
        set: (value: number) => {
          widthAssignments += 1;
          width = value;
        },
      },
      height: {
        configurable: true,
        get: () => height,
        set: (value: number) => {
          heightAssignments += 1;
          height = value;
        },
      },
    });
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform(emptyScene().contentBounds, 160, 120);

    renderMinimapToCanvas(canvas, emptyScene(), transform, null, colors);
    renderMinimapToCanvas(canvas, emptyScene(), transform, null, colors);

    expect(width).toBe(320);
    expect(height).toBe(240);
    expect(widthAssignments).toBe(1);
    expect(heightAssignments).toBe(1);
    expect(context.setTransform).toHaveBeenCalledTimes(2);
  });
});
