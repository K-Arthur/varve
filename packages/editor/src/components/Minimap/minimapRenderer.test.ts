/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMinimapTransform } from './minimapLayout';
import { renderMinimap, renderMinimapToCanvas, resolveMinimapColors } from './minimapRenderer';

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

  it('keeps hidden-node fills theme-aware and faint', () => {
    let globalAlpha = 1;
    let fillStyle = '';
    const stack: Array<{ globalAlpha: number; fillStyle: string }> = [];
    const fills: Array<{ alpha: number; color: string }> = [];
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(() => fills.push({ alpha: globalAlpha, color: fillStyle })),
      save: vi.fn(() => stack.push({ globalAlpha, fillStyle })),
      restore: vi.fn(() => {
        const previous = stack.pop();
        globalAlpha = previous?.globalAlpha ?? 1;
        fillStyle = previous?.fillStyle ?? '';
      }),
      get globalAlpha() {
        return globalAlpha;
      },
      set globalAlpha(value: number) {
        globalAlpha = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = value;
      },
    } as unknown as CanvasRenderingContext2D;
    const colors = resolveMinimapColors((name, fallback) =>
      name === '--color-text-disabled' ? 'oklch(0.58 0.025 261)' : fallback,
    );
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);

    renderMinimap(
      context,
      {
        ...emptyScene(),
        entries: [
          {
            id: 'hidden-shape',
            kind: 'shape',
            bounds: { x: 10, y: 10, w: 20, h: 20 },
            visible: false,
            locked: false,
            isFrame: false,
            isContainer: false,
            selected: false,
            name: 'Hidden shape',
            depth: 0,
          },
        ],
      },
      transform,
      null,
      colors,
    );

    expect(fills[1]).toEqual({ alpha: 0.15, color: 'oklch(0.58 0.025 261)' });
    expect(globalAlpha).toBe(1);
  });

  it('does not reallocate the backing store when only the camera projection redraws', () => {
    const canvas = document.createElement('canvas');
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    });
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
    // Each redraw copies the cached document layer 1:1, then draws the
    // viewport indicator at the device pixel ratio.
    expect(vi.mocked(context.setTransform).mock.calls).toEqual([
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 0, 0],
    ]);
  });

  it('redraws only the viewport indicator when the camera alone changes', () => {
    const canvas = document.createElement('canvas');
    const main = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    Object.defineProperty(canvas, 'getContext', { configurable: true, value: () => main });
    const layerContext = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn() };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = createElement(tag);
      if (tag === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: () => layerContext,
        });
      }
      return element;
    }) as typeof document.createElement);
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const scene = emptyScene();
    const transform = computeMinimapTransform(scene.contentBounds, 160, 120);
    const footprint = (x: number) => ({
      points: [
        [x, 10],
        [x + 20, 10],
        [x + 20, 30],
        [x, 30],
      ] as Array<[number, number]>,
    });

    renderMinimapToCanvas(canvas, scene, transform, footprint(10) as never, colors);
    renderMinimapToCanvas(canvas, scene, transform, footprint(40) as never, colors);

    expect(layerContext.fillRect).toHaveBeenCalledTimes(1);
    expect(main.drawImage).toHaveBeenCalledTimes(2);
    expect(main.stroke).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
