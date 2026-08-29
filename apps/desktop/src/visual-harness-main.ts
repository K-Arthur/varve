/**
 * Visual regression test harness entry point.
 *
 * Loaded via visual-harness.html by Playwright specs under
 * tests/e2e/visual/. Exposes `window.__renderFixture` so a spec can push a
 * RenderItem[] fixture and get real browser canvas rasterization —
 * unlike jsdom (see tests/e2e/visual/README.md), a real browser's 2D
 * canvas context actually paints pixels, which is the whole point.
 *
 * Deliberately NOT the full app: this exercises `replayIr` (the engine's
 * primitive-level paint function) directly, not the full
 * CanvasArea/replaySubtreeToCtx orchestration (mask compositing, group
 * isolation surfaces, nested clips). See tests/e2e/visual/README.md for why.
 */

import {
  applyPropertyPath,
  computeDocumentDirtyRegion,
  sampleTimelineAt,
  worldRectsToScreen,
} from '@varve/editor';
import type { RenderItem } from '@varve/engine';
import { getImageCache, type ReplayTarget, replayIr } from '@varve/engine';
import { addNode, createDocument, makeShapeNode, type Timeline } from '@varve/scene';

interface MotionFixturePayload {
  items: { nodeId: string; item: RenderItem }[];
  timeline: Timeline;
  time: number;
}

declare global {
  interface Window {
    __renderFixture: (items: RenderItem[], width: number, height: number) => Promise<void>;
    __renderMotionFixture: (
      fixture: MotionFixturePayload,
      width: number,
      height: number,
    ) => Promise<void>;
    __renderBoardFixture: (items: RenderItem[], width: number, height: number) => void;
    __renderPartialFrame: (
      items: RenderItem[],
      width: number,
      height: number,
      dirtyRects: { x: number; y: number; w: number; h: number }[],
    ) => void;
    __capturePixels: () => number;
    __diffPixels: () => {
      diffPixels: number;
      maxDelta: number;
      total: number;
      hashA: number;
      hashB: number;
    };
    /**
     * Production dirty-diff baseline oracle.
     *
     * Reproduces the overtaken-frame sequence exactly as the editor's render
     * pipeline runs it, using the REAL document-diff functions
     * (`computeDocumentDirtyRegion` + the paint path's screen-rect mapping):
     *
     *   1. full render of L (a rect at the origin)
     *   2. partial frame painting A (the rect at an intermediate drag
     *      position) within dirty(L → A)
     *   3. partial frame painting B (the rect deleted — "delete while
     *      dragging") within dirty(baseline → B)
     *
     * `rule` selects the baseline the third frame diffs against:
     *   - 'buggy': the last COMPLETED doc (L) — the pre-fix production
     *     behaviour, which misses every pixel the overtaken frame painted;
     *   - 'painted-doc': the doc the overtaken frame actually painted (A) —
     *     the post-fix behaviour.
     *
     * The final surface is diffed against a clean full render of B, so the
     * ghost (the deleted rect's silhouette at the intermediate position) is
     * measured in real pixels. `ghostDiffPixels` counts diffs inside the
     * intermediate position; `otherDiffPixels` counts everything else.
     */
    __runStaleBaselineScenario: (rule: 'buggy' | 'painted-doc') => {
      diffPixels: number;
      maxDelta: number;
      total: number;
      ghostDiffPixels: number;
      otherDiffPixels: number;
      rectsPaintedDoc: { x: number; y: number; w: number; h: number }[];
      rectsBuggy: { x: number; y: number; w: number; h: number }[];
      /** PNG data URLs of the three surfaces for artifact capture. */
      surfaces: { buggy: string; fixed: string; reference: string };
    };
    __harnessReady: boolean;
  }
}

async function preloadFixtureImages(items: readonly RenderItem[]): Promise<void> {
  const sources = new Set<string>();
  for (const item of items) {
    for (const fill of item.fills ?? []) {
      if (fill.type === 'image') {
        if (fill.src) sources.add(fill.src);
        if (fill.alphaMask) sources.add(fill.alphaMask);
      } else if (fill.type === 'pattern' && fill.tileSrc) {
        sources.add(fill.tileSrc);
      }
    }
  }
  await Promise.all([...sources].map((src) => getImageCache().load(src)));
}

async function renderItems(items: RenderItem[], width: number, height: number): Promise<void> {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.clearRect(0, 0, width, height);
  await preloadFixtureImages(items);
  replayIr(ctx as unknown as ReplayTarget, items);
}

window.__renderFixture = async (items: RenderItem[], width: number, height: number) => {
  await renderItems(items, width, height);
};

window.__renderMotionFixture = async (
  fixture: MotionFixturePayload,
  width: number,
  height: number,
) => {
  const doc = {
    ...createDocument('Motion visual fixture', true),
    timelines: { [fixture.timeline.id]: fixture.timeline },
  };
  const sample = sampleTimelineAt(doc, fixture.timeline.id, fixture.time);
  const items = fixture.items.map(({ nodeId, item }) => {
    const copy = structuredClone(item);
    const overrides = sample.overrides.get(nodeId);
    if (overrides) {
      for (const [property, value] of overrides) {
        applyPropertyPath(copy as unknown as Record<string, unknown>, property, value);
      }
    }
    return copy;
  });
  await renderItems(items, width, height);
};

/**
 * Partial redraw oracle: render a (possibly pruned) item subset under a
 * multi-rect clip, mimicking the production partial-redraw paint path
 * (per-rect clear + board fill + multi-path clip). Pixels outside the dirty
 * rects are retained — exactly how the real backing store behaves — so
 * rendering the oracle frame on top of the full frame and diffing must be
 * pixel-identical when the pruned subset is correct.
 */
/** Full redraw oracle with an explicit white board fill (matches partial). */
window.__renderBoardFixture = (items: RenderItem[], width: number, height: number) => {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  replayIr(ctx as unknown as ReplayTarget, items);
};

window.__renderPartialFrame = (
  items: RenderItem[],
  width: number,
  height: number,
  dirtyRects: { x: number; y: number; w: number; h: number }[],
) => {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  for (const rect of dirtyRects) {
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.save();
  ctx.beginPath();
  for (const rect of dirtyRects) {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.clip();
  replayIr(ctx as unknown as ReplayTarget, items);
  ctx.restore();
};

interface PixelCapture {
  hash: number;
  pixels: Uint8ClampedArray;
}

/** A rect node at the given world position, plus its RenderItem twin. */
function scenarioRectItem(
  x: number,
  y: number,
): { item: RenderItem; doc: import('@varve/scene').Document } {
  const transform = [1, 0, 0, 1, x, y] as const;
  const item: RenderItem = {
    transform,
    fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  };
  const doc = addNode(
    createDocument('StaleBaseline', true),
    makeShapeNode('x', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }, { transform }),
  );
  return { item, doc };
}

function deleteNodeFrom(doc: import('@varve/scene').Document): import('@varve/scene').Document {
  return {
    ...doc,
    nodes: Object.fromEntries(
      Object.entries(doc.nodes).filter(([id]) => id !== 'x'),
    ) as import('@varve/scene').Document['nodes'],
    rootChildren: doc.rootChildren.filter((id) => id !== 'x'),
  };
}

/**
 * Dirty world bounds → the paint path's screen rects (identity camera at
 * zoom 1: world px == CSS px), including the 40px anti-aliasing margin and
 * the outward rounding the production clip uses.
 */
function dirtyScreenRects(
  previous: import('@varve/scene').Document,
  next: import('@varve/scene').Document,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number }[] {
  const dirty = computeDocumentDirtyRegion(previous, next);
  if (dirty.kind !== 'partial') return [];
  return worldRectsToScreen(
    [dirty.bounds],
    (wx: number, wy: number) => [wx, wy] as const,
    width,
    height,
  );
}

window.__runStaleBaselineScenario = (rule) => {
  const WIDTH = 800;
  const HEIGHT = 600;

  // L: rect rendered at the origin. A: the same rect at an intermediate drag
  // position (the frame that painted it was overtaken). B: the rect deleted —
  // the "delete while dragging" interaction.
  const l = scenarioRectItem(0, 0);
  const a = scenarioRectItem(200, 400);
  const bDoc = deleteNodeFrom(a.doc);

  const rectsLToA = dirtyScreenRects(l.doc, a.doc, WIDTH, HEIGHT);
  const rectsBuggy = dirtyScreenRects(l.doc, bDoc, WIDTH, HEIGHT);
  const rectsPaintedDoc = dirtyScreenRects(a.doc, bDoc, WIDTH, HEIGHT);

  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const paintPartial = (
    items: RenderItem[],
    rects: { x: number; y: number; w: number; h: number }[],
  ) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    for (const rect of rects) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.save();
    ctx.beginPath();
    for (const rect of rects) {
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.clip();
    replayIr(ctx as unknown as ReplayTarget, items);
    ctx.restore();
  };
  const board = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  };

  // Frame 1: full render of L (the surface before any of this). Frame 2: the
  // overtaken partial frame paints A inside dirty(L → A). Frame 3: doc B,
  // diffed against the selected baseline.
  const renderRule = (baseline: 'buggy' | 'painted-doc' | 'none'): void => {
    board();
    replayIr(ctx as unknown as ReplayTarget, [l.item]);
    paintPartial([a.item], rectsLToA);
    if (baseline === 'buggy') paintPartial([], rectsBuggy);
    else if (baseline === 'painted-doc') paintPartial([], rectsPaintedDoc);
  };

  // Reference: a clean full render of B (the board).
  board();
  const reference = capturePixels();

  renderRule(rule);
  const simulated = capturePixels();

  let diffPixels = 0;
  let ghostDiffPixels = 0;
  let otherDiffPixels = 0;
  let maxDelta = 0;
  const aPixels = simulated.pixels;
  const bPixels = reference.pixels;
  const minLength = Math.min(aPixels.length, bPixels.length);
  const total = minLength / 4;
  for (let i = 0; i < minLength; i += 4) {
    const delta =
      Math.abs(aPixels[i]! - bPixels[i]!) +
      Math.abs(aPixels[i + 1]! - bPixels[i + 1]!) +
      Math.abs(aPixels[i + 2]! - bPixels[i + 2]!);
    if (delta > 0) {
      diffPixels++;
      maxDelta = Math.max(maxDelta, delta);
      const px = (i / 4) % WIDTH;
      const py = Math.floor(i / 4 / WIDTH);
      const inGhost = px >= 200 - 2 && px < 240 + 2 && py >= 400 - 2 && py < 440 + 2;
      if (inGhost) ghostDiffPixels++;
      else otherDiffPixels++;
    }
  }

  // Surface PNGs for artifact capture: buggy rule, painted-doc rule, reference.
  const surfacePng = (paint: () => void): string => {
    paint();
    return canvas.toDataURL('image/png');
  };
  const surfaces = {
    buggy: surfacePng(() => renderRule('buggy')),
    fixed: surfacePng(() => renderRule('painted-doc')),
    reference: surfacePng(() => board()),
  };

  return {
    diffPixels,
    maxDelta,
    total,
    ghostDiffPixels,
    otherDiffPixels,
    rectsPaintedDoc,
    rectsBuggy,
    surfaces,
  };
};

let lastCapture: PixelCapture | null = null;

function capturePixels(): PixelCapture {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let hash = 0x811c9dc5;
  const data = image.data;
  // Sample every pixel; FNV-1a over the raw RGBA bytes.
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 4; k++) {
      hash ^= data[i + k]!;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return { hash: hash >>> 0, pixels: data };
}

/** Capture the current canvas pixels as the oracle reference. */
window.__capturePixels = () => {
  lastCapture = capturePixels();
  return lastCapture.hash;
};

/** Diff the current canvas against the last capture; clears the reference. */
window.__diffPixels = () => {
  const current = capturePixels();
  const reference = lastCapture;
  lastCapture = null;
  if (!reference) return { diffPixels: -1, maxDelta: 0, total: 0, hashA: 0, hashB: 0 };
  let diffPixels = 0;
  let maxDelta = 0;
  const a = reference.pixels;
  const b = current.pixels;
  const total = Math.min(a.length, b.length) / 4;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = Math.abs(a[i]! - b[i]!);
    if (delta > 0) {
      if (i % 4 === 0) diffPixels++;
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return {
    diffPixels,
    maxDelta,
    total,
    hashA: reference.hash,
    hashB: current.hash,
  };
};

window.__harnessReady = true;
