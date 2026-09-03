/**
 * Tests for image fill modes (fit, fill, stretch, tile) in replay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import { computeImagePlacement, localToSourcePixel } from './imagePlacement';
import { projectedLongEdgeForTransform } from './mockup/warpReplay';
import { replayIr } from './replay';
import type { FillIR, RenderItem } from './types';

/** Create a lightweight mock image that serialises to its src string. */
function mockImage(src: string, naturalWidth: number, naturalHeight: number): HTMLImageElement {
  const img = {
    src,
    naturalWidth,
    naturalHeight,
    toString: () => src,
  } as unknown as HTMLImageElement;
  return img;
}

/** Worker-side image source: ImageBitmap exposes width/height, not naturalWidth/naturalHeight. */
function mockBitmap(src: string, width: number, height: number): ImageBitmap {
  return {
    width,
    height,
    close: () => undefined,
    toString: () => src,
  } as unknown as ImageBitmap;
}

function makeRecorder(): {
  calls: string[];
  filter: string;
  drawImage: (
    image: CanvasImageSource | string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  target: Parameters<typeof replayIr>[0];
} {
  const calls: string[] = [];
  let filter = 'none';
  return {
    calls,
    get filter() {
      return filter;
    },
    set filter(v: string) {
      filter = v;
    },
    drawImage: (
      image: CanvasImageSource | string,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      calls.push(
        `drawImage ${image} ${dx.toFixed(1)} ${dy.toFixed(1)} ${dw.toFixed(1)} ${dh.toFixed(1)}`,
      );
    },
    target: {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      transform: () => calls.push('transform'),
      translate: () => calls.push('translate'),
      rotate: () => calls.push('rotate'),
      scale: () => calls.push('scale'),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
      beginPath: () => calls.push('beginPath'),
      rect: () => calls.push('rect'),
      clip: () => calls.push('clip'),
      ellipse: () => calls.push('ellipse'),
      arc: () => calls.push('arc'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      bezierCurveTo: () => calls.push('bezierCurveTo'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      closePath: () => calls.push('closePath'),
      fillText: () => calls.push('fillText'),
      font: '10px sans-serif',
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt' as CanvasLineCap,
      lineJoin: 'miter' as CanvasLineJoin,
      textAlign: 'left' as CanvasTextAlign,
      strokeStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }),
      get filter() {
        return filter;
      },
      set filter(v: string) {
        filter = v;
      },
      lineDashOffset: 0,
      setLineDash: () => calls.push('setLineDash'),
      drawImage: (
        image: CanvasImageSource | string,
        a1: number,
        a2: number,
        a3: number,
        a4: number,
        ...rest: number[]
      ) => {
        // Supports both 4-arg drawImage(image, dx, dy, dw, dh) and
        // 9-arg drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh).
        // Records the destination rect (dx, dy, dw, dh).
        if (rest.length >= 4) {
          // 9-arg: rest = [dx, dy, dw, dh]
          calls.push(
            `drawImage ${image} ${rest[0]!.toFixed(1)} ${rest[1]!.toFixed(1)} ${rest[2]!.toFixed(1)} ${rest[3]!.toFixed(1)}`,
          );
        } else {
          // 4-arg: a1-a4 = dx, dy, dw, dh
          calls.push(
            `drawImage ${image} ${a1.toFixed(1)} ${a2.toFixed(1)} ${a3.toFixed(1)} ${a4.toFixed(1)}`,
          );
        }
      },
    },
  };
}

function imageFill(
  overrides: Omit<Extract<FillIR, { type: 'image' }>, 'opacity' | 'blendMode' | 'visible'>,
): Extract<FillIR, { type: 'image' }> {
  return {
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    ...overrides,
  } as Extract<FillIR, { type: 'image' }>;
}

function rectItem(w: number, h: number, fill: FillIR): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [fill],
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    opacity: 1,
    blendMode: 'normal',
  };
}

function offsetRectItem(x: number, y: number, w: number, h: number, fill: FillIR): RenderItem {
  return {
    ...rectItem(w, h, fill),
    primitive: { kind: 'rect', x, y, w, h },
  };
}

beforeEach(() => {
  resetImageCache();
  const cache = getImageCache();
  // Pre-load mock images used across tests so paintImageFill takes the cached path.
  cache.setLoaded('img1', mockImage('img1', 100, 50));
  cache.setLoaded('img2', mockImage('img2', 200, 100));
  cache.setLoaded('img3', mockImage('img3', 200, 100));
  cache.setLoaded('img4', mockImage('img4', 200, 100));
  cache.setLoaded('img5', mockImage('img5', 40, 40));
  cache.setLoaded('img6', mockImage('img6', 50, 50));
  cache.setLoaded('imgA', mockImage('imgA', 100, 100));
  cache.setLoaded('imgB', mockImage('imgB', 100, 100));
});

afterEach(() => {
  resetImageCache();
});

describe('image fill modes', () => {
  it('computes a conservative source footprint for scaled and skewed fills', () => {
    expect(projectedLongEdgeForTransform(400, 200, { a: 2, b: 0, c: 0, d: 2 })).toBe(800);
    expect(projectedLongEdgeForTransform(400, 200, { a: 2, b: 0, c: 1, d: 2 })).toBeGreaterThan(
      800,
    );
  });

  it('draws the closest resident proxy while requesting a sharper representation', () => {
    const source = 'data:image/png;base64,progressive-source';
    const cache = getImageCache();
    const resident = mockBitmap('resident-512', 512, 256);
    cache.setLoaded(cache.atSizeKey(source, 512), resident);
    const loadAtSize = vi.spyOn(cache, 'loadAtSize').mockResolvedValue(resident);
    const { target, calls } = makeRecorder();

    replayIr(
      target,
      [
        rectItem(
          400,
          200,
          imageFill({
            type: 'image',
            src: source,
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 4000,
            imageHeight: 2000,
          }),
        ),
      ],
      undefined,
      undefined,
      {
        intent: 'settled-preview',
        resolveMaxSourceDim: () => 2048,
      },
    );

    expect(loadAtSize).toHaveBeenCalledWith(source, 2048, { width: 4000, height: 2000 });
    expect(calls.some((call) => call.includes('resident-512'))).toBe(true);
  });

  it('uses an interactive proxy while keeping authoritative source dimensions', () => {
    const source = 'data:image/png;base64,adaptive-source';
    const cache = getImageCache();
    cache.setLoaded(source, mockImage(source, 4000, 2000));
    cache.setLoaded(cache.atSizeKey(source, 512), mockBitmap('adaptive-proxy', 512, 256));
    const { target, calls } = makeRecorder();

    replayIr(
      target,
      [
        rectItem(
          400,
          200,
          imageFill({
            type: 'image',
            src: source,
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 4000,
            imageHeight: 2000,
          }),
        ),
      ],
      undefined,
      undefined,
      { intent: 'interactive', maxSourceDim: 512 },
    );

    expect(calls.filter((call) => call.includes('adaptive-proxy'))).toHaveLength(1);
  });

  it('stretch fills the whole primitive bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({ type: 'image', src: 'img1', fit: 'stretch', x: 0, y: 0, scale: 1 }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    expect(draw[0]).toBe('drawImage img1 0.0 0.0 100.0 50.0');
  });

  it('fit keeps aspect ratio inside bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img2',
          fit: 'fit',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 200,
          imageHeight: 100,
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    // 200x100 image aspect 2:1 fits in 100x50 => exactly 100x50
    expect(draw[0]).toBe('drawImage img2 0.0 0.0 100.0 50.0');
  });

  it('fit letterboxes when aspect differs', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'img3',
          fit: 'fit',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 200,
          imageHeight: 100,
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw[0]).toBe('drawImage img3 0.0 25.0 100.0 50.0');
  });

  it('fill crops to cover bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'img4',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 200,
          imageHeight: 100,
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // 200x100 image fills 100x100 -> aspect 2:1, bounds 1:1 -> dh=100, dw=200, centered
    expect(draw[0]).toBe('drawImage img4 -50.0 0.0 200.0 100.0');
  });

  it('tile repeats image across bounds', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'img5',
          fit: 'tile',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 40,
          imageHeight: 40,
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // 100x100 bounds / 40x40 tiles = 3x3 grid = 9 draws (with some overhang)
    expect(draw.length).toBe(9);
    expect(draw[0]).toBe('drawImage img5 0.0 0.0 40.0 40.0');
  });

  it.each([
    {
      label: 'positive offsets',
      x: 7,
      y: -3,
      firstDraw: 'drawImage img2 -183.0 17.0 200.0 100.0',
      sample: { x: 193, y: 3 },
    },
    {
      label: 'negative offsets',
      x: -7,
      y: -103,
      firstDraw: 'drawImage img2 3.0 17.0 200.0 100.0',
      sample: { x: 7, y: 3 },
    },
  ])('tiles cover non-zero bounds for $label and mapping observes replay anchors', (testCase) => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      offsetRectItem(
        10,
        20,
        250,
        140,
        imageFill({
          type: 'image',
          src: 'img2',
          fit: 'tile',
          x: testCase.x,
          y: testCase.y,
          scale: 1,
        }),
      ),
    ]);
    const placement = computeImagePlacement({
      fit: 'tile',
      sourceWidth: 200,
      sourceHeight: 100,
      bounds: { x: 10, y: 20, w: 250, h: 140 },
      x: testCase.x,
      y: testCase.y,
    });
    expect(calls.find((call) => call.startsWith('drawImage'))).toBe(testCase.firstDraw);
    expect(placement?.drawRect.x).toBe(Number(testCase.firstDraw.split(' ')[2]));
    expect(placement?.drawRect.y).toBe(Number(testCase.firstDraw.split(' ')[3]));
    const sampled = localToSourcePixel(placement!, { x: 10, y: 20 });
    expect(sampled?.x).toBeCloseTo(testCase.sample.x, 12);
    expect(sampled?.y).toBeCloseTo(testCase.sample.y, 12);
    expect(localToSourcePixel(placement!, { x: 259.999, y: 159.999 })).not.toBeNull();
  });

  it('applies image scale', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'img6',
          fit: 'fit',
          x: 0,
          y: 0,
          scale: 2,
          imageWidth: 50,
          imageHeight: 50,
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    // Fit first produces 100x100, then the explicit 2x content scale is
    // applied around the frame centre.
    expect(draw[0]).toBe('drawImage img6 -50.0 -50.0 200.0 200.0');
  });

  it('triggers load for alpha mask when not cached', async () => {
    // Mock document for the test environment
    global.document = {} as Document;
    const cache = getImageCache();
    const maskUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const { target } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'imgA',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 100,
          imageHeight: 100,
          alphaMask: maskUrl,
        }),
      ),
    ]);
    // Mask load is async; wait for it to settle
    await new Promise((resolve) => setTimeout(resolve, 0));
    // This suite runs under the Node (non-jsdom) Vitest environment, so the
    // global `Image` constructor genuinely does not exist here — `cache.load()`
    // fails synchronously with "Image is not defined" once it actually
    // attempts to construct one. What this test is really asserting is that
    // replayIr triggered a load for the mask at all (a cache entry now exists
    // for it, distinct from "never touched"); the terminal state that proves
    // the load was attempted and its failure was handled is 'error', not a
    // permanently stuck 'loading' (an entry that never resolves either way
    // would itself be a bug — nothing could ever detect or recover from it).
    const maskEntry = cache.get(maskUrl);
    expect(maskEntry?.state).toBe('error');
    delete (global as unknown as { document?: Document }).document;
  });

  it('uses cached alpha mask for compositing', () => {
    const cache = getImageCache();
    const maskUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    // Pre-load mask image
    cache.setLoaded(maskUrl, mockImage(maskUrl, 100, 100));
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'imgB',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 100,
          imageHeight: 100,
          alphaMask: maskUrl,
        }),
      ),
    ]);
    // With a cached mask, replay should issue drawImage calls (compositing happens in canvas)
    // The exact number depends on offscreen canvas compositing, but we should see at least one draw
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBeGreaterThan(0);
  });

  it('uses the identical crop and content transform for image and alpha mask', () => {
    const maskUrl = 'mask-aligned';
    getImageCache().setLoaded(maskUrl, mockImage(maskUrl, 200, 100));
    const internalDraws: Array<{ source: string; args: number[] }> = [];
    const context = {
      translate: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      drawImage: (source: CanvasImageSource, ...args: number[]) => {
        internalDraws.push({ source: String(source), args });
      },
      globalCompositeOperation: 'source-over',
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    global.document = {
      createElement: () => canvas,
    } as unknown as Document;

    const fill = imageFill({
      type: 'image',
      src: 'img2',
      fit: 'fill',
      x: 4,
      y: -3,
      scale: 1.25,
      crop: { x: 50, y: 20, w: 100, h: 50 },
      rotation: 90,
      flipH: true,
      alphaMask: maskUrl,
    });
    const { target } = makeRecorder();
    replayIr(target, [rectItem(100, 100, fill)]);

    expect(internalDraws).toHaveLength(2);
    expect(internalDraws[0]?.source).toBe('img2');
    expect(internalDraws[1]?.source).toBe(maskUrl);
    expect(internalDraws[1]?.args).toEqual(internalDraws[0]?.args);

    // A settled masked result is reused rather than allocating and compositing
    // another bounds-sized canvas during the next replay.
    replayIr(target, [rectItem(100, 100, fill)]);
    expect(internalDraws).toHaveLength(2);
    delete (global as unknown as { document?: Document }).document;
  });
});

describe('worker image lookup parity', () => {
  const cases: Array<{
    name: string;
    fill: Extract<FillIR, { type: 'image' }>;
    expected: string[];
  }> = [
    {
      name: 'stretch',
      fill: imageFill({ type: 'image', src: 'worker', fit: 'stretch', x: 7, y: 9, scale: 2 }),
      expected: ['drawImage worker 7.0 9.0 100.0 100.0'],
    },
    {
      name: 'fit with offsets and scale',
      fill: imageFill({ type: 'image', src: 'worker', fit: 'fit', x: 7, y: 9, scale: 2 }),
      expected: ['drawImage worker -43.0 9.0 200.0 100.0'],
    },
    {
      name: 'fill with offsets and scale',
      fill: imageFill({ type: 'image', src: 'worker', fit: 'fill', x: 7, y: 9, scale: 2 }),
      expected: ['drawImage worker -143.0 -41.0 400.0 200.0'],
    },
    {
      name: 'tile with offsets and scale',
      fill: imageFill({ type: 'image', src: 'worker', fit: 'tile', x: 7, y: 9, scale: 0.5 }),
      expected: [
        'drawImage worker -43.0 -16.0 50.0 25.0',
        'drawImage worker 7.0 -16.0 50.0 25.0',
        'drawImage worker 57.0 -16.0 50.0 25.0',
        'drawImage worker -43.0 9.0 50.0 25.0',
        'drawImage worker 7.0 9.0 50.0 25.0',
        'drawImage worker 57.0 9.0 50.0 25.0',
        'drawImage worker -43.0 34.0 50.0 25.0',
        'drawImage worker 7.0 34.0 50.0 25.0',
        'drawImage worker 57.0 34.0 50.0 25.0',
        'drawImage worker -43.0 59.0 50.0 25.0',
        'drawImage worker 7.0 59.0 50.0 25.0',
        'drawImage worker 57.0 59.0 50.0 25.0',
        'drawImage worker -43.0 84.0 50.0 25.0',
        'drawImage worker 7.0 84.0 50.0 25.0',
        'drawImage worker 57.0 84.0 50.0 25.0',
      ],
    },
  ];

  for (const testCase of cases) {
    it(`preserves ${testCase.name} geometry`, () => {
      const { target, calls } = makeRecorder();
      const bitmap = mockBitmap('worker', 100, 50);

      replayIr(target, [rectItem(100, 100, testCase.fill)], (src) =>
        src === 'worker' ? bitmap : undefined,
      );

      expect(calls.filter((call) => call.startsWith('drawImage'))).toEqual(testCase.expected);
    });
  }
});

describe('image crop rect', () => {
  it('renders only the crop region with 9-arg drawImage', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img2',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 200,
          imageHeight: 100,
          crop: { x: 50, y: 25, w: 100, h: 50 },
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    // The crop remains at its corresponding destination within the full-image
    // placement instead of being stretched back over the complete bounds.
    expect(draw[0]).toBe('drawImage img2 25.0 12.5 50.0 25.0');
  });

  it('crop preserves full-source fit placement', () => {
    const { target, calls } = makeRecorder();
    // Source is 200x100, crop is 100x100 (square). Fit into 100x100 bounds.
    replayIr(target, [
      rectItem(
        100,
        100,
        imageFill({
          type: 'image',
          src: 'img2',
          fit: 'fit',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 200,
          imageHeight: 100,
          crop: { x: 50, y: 0, w: 100, h: 100 },
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    // The full 2:1 source fits at 100x50, then its center crop occupies the
    // corresponding 50x50 destination without being reinterpreted as square.
    expect(draw[0]).toBe('drawImage img2 25.0 25.0 50.0 50.0');
  });

  it('crop with stretch fills bounds ignoring original aspect', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        80,
        40,
        imageFill({
          type: 'image',
          src: 'img1',
          fit: 'stretch',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 100,
          imageHeight: 50,
          crop: { x: 10, y: 5, w: 50, h: 25 },
        }),
      ),
    ]);
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
    expect(draw[0]).toBe('drawImage img1 8.0 4.0 40.0 20.0');
  });
});

describe('image rotation and flip', () => {
  it('applies rotation transform around draw rect center', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img1',
          fit: 'stretch',
          x: 0,
          y: 0,
          scale: 1,
          rotation: 90,
        }),
      ),
    ]);
    // Should have save + translate + rotate + drawImage + restore
    expect(calls).toContain('save');
    expect(calls).toContain('translate');
    expect(calls).toContain('rotate');
    expect(calls).toContain('restore');
    const draw = calls.filter((c) => c.startsWith('drawImage'));
    expect(draw.length).toBe(1);
  });

  it('applies flipH via scale transform', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img1',
          fit: 'stretch',
          x: 0,
          y: 0,
          scale: 1,
          flipH: true,
        }),
      ),
    ]);
    expect(calls).toContain('save');
    expect(calls).toContain('translate');
    expect(calls).toContain('scale');
    expect(calls).toContain('restore');
  });

  it('applies combined rotation + flip', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img1',
          fit: 'stretch',
          x: 0,
          y: 0,
          scale: 1,
          rotation: 45,
          flipH: true,
          flipV: true,
        }),
      ),
    ]);
    expect(calls).toContain('save');
    expect(calls).toContain('translate');
    expect(calls).toContain('rotate');
    expect(calls).toContain('scale');
    expect(calls).toContain('restore');
  });

  it('no transform calls when rotation=0 and no flip', () => {
    const { target, calls } = makeRecorder();
    replayIr(target, [
      rectItem(
        100,
        50,
        imageFill({
          type: 'image',
          src: 'img1',
          fit: 'stretch',
          x: 0,
          y: 0,
          scale: 1,
        }),
      ),
    ]);
    expect(calls).not.toContain('translate');
    expect(calls).not.toContain('rotate');
    expect(calls).not.toContain('scale');
  });
});
