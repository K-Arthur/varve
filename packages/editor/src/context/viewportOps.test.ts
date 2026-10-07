import {
  addChild,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  makeShapeNode,
  setActiveDesignCanvas,
  setPagePlacement,
} from '@varve/scene';
import { type Viewport, worldToScreen } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import type { EditorCameraState } from '../canvas/cameraState';
import {
  computeFitActiveSurfaceCamera,
  computeFitAllCamera,
  computeZoomStep,
  computeZoomTo,
  getCanvasFitRegion,
} from './viewportOps';

const viewport: Viewport = { width: 1000, height: 800 };

describe('getCanvasFitRegion', () => {
  it.each([
    ['bottom', [300, 800, 500, 60], { x: 0, y: 0, w: 1000, h: 592 }],
    ['left', [110, 300, 60, 400], { x: 78, y: 0, w: 922, h: 800 }],
    ['outside', [1200, 300, 60, 400], { x: 0, y: 0, w: 1000, h: 800 }],
  ] as const)(
    'keeps %s palette geometry outside the fitting region',
    (_name, palette, expected) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'editor-canvas__content-layer';
      const toolbar = document.createElement('div');
      toolbar.className = 'floating-toolbar';
      toolbar.dataset.testid = 'toolbar';
      canvas.getBoundingClientRect = () => new DOMRect(100, 200, 1000, 800);
      toolbar.getBoundingClientRect = () => new DOMRect(...palette);
      document.body.append(canvas, toolbar);
      try {
        expect(getCanvasFitRegion(viewport)).toEqual(expected);
      } finally {
        canvas.remove();
        toolbar.remove();
      }
    },
  );
});

describe('computeFitActiveSurfaceCamera', () => {
  it('fits only the active unbounded canvas, excluding inactive canvases and pages', () => {
    let doc = createDesignCanvas(createDocument('Mixed surfaces'), { name: 'Active art' });
    const activeId = doc.activeDesignCanvasId!;
    doc = addChild(
      doc,
      designCanvasContentRoot(doc)!,
      makeShapeNode(
        'active-art',
        { kind: 'rect', x: 0, y: 0, w: 320, h: 180 },
        { transform: [1, 0, 0, 1, 200, 100] },
      ),
    );
    doc = createDesignCanvas(doc, { name: 'Unrelated large artwork' });
    doc = addChild(
      doc,
      designCanvasContentRoot(doc)!,
      makeShapeNode('other-art', { kind: 'rect', x: 0, y: 0, w: 10000, h: 10000 }),
    );
    doc = setActiveDesignCanvas(doc, activeId);
    const camera = computeFitActiveSurfaceCamera(doc, 'design', viewport)!;
    expect(camera.zoom).toBeCloseTo(920 / 320);
    expect(360 * camera.zoom + camera.pan.x).toBeCloseTo(500);
    expect(190 * camera.zoom + camera.pan.y).toBeCloseTo(400);
  });

  it('fits placed publishing trim, including a blank page, rather than its overflowing artwork', () => {
    let doc = createDocument('Print');
    const page = doc.pages![0]!;
    doc = setPagePlacement(doc, page.id, { x: 2100, y: -600 });
    const blankCamera = computeFitActiveSurfaceCamera(doc, 'print', viewport)!;
    expect(blankCamera.zoom).toBeCloseTo(920 / 1920);
    expect(3060 * blankCamera.zoom + blankCamera.pan.x).toBeCloseTo(500);
    expect(-60 * blankCamera.zoom + blankCamera.pan.y).toBeCloseTo(400);
    doc = addChild(
      doc,
      page.contentRoot,
      makeShapeNode('overflow', { kind: 'rect', x: -10000, y: -10000, w: 20000, h: 20000 }),
    );
    expect(computeFitActiveSurfaceCamera(doc, 'print', viewport)).toEqual(blankCamera);
  });

  it('uses publishing pages for comic Draw and preserves view rotation', () => {
    const doc = { ...createDocument('Comic'), workflowProfile: 'comic-print' as const };
    const camera = computeFitActiveSurfaceCamera(doc, 'drawing', viewport, Math.PI / 4)!;
    expect(camera.rotation).toBeCloseTo(Math.PI / 4);
    expect(camera.zoom).toBeCloseTo(720 / ((1920 + 1080) / Math.sqrt(2)));
  });

  it('does not invent page geometry for an empty Design Canvas or a missing publishing page', () => {
    const doc = createDesignCanvas(createDocument('Empty', true));
    expect(computeFitActiveSurfaceCamera(doc, 'design', viewport)).toBeNull();
    expect(computeFitActiveSurfaceCamera(doc, 'print', viewport)).toBeNull();
  });

  it('keeps page-only Photo fitting while an explicit empty canvas remains unbounded', () => {
    const paged = createDocument('Page-only Photo');
    expect(computeFitActiveSurfaceCamera(paged, 'photo', viewport)).toEqual(
      computeFitActiveSurfaceCamera(paged, 'print', viewport),
    );
    expect(computeFitActiveSurfaceCamera(createDesignCanvas(paged), 'photo', viewport)).toBeNull();
  });

  it('keeps rotated artwork inside the unobstructed region of the full viewport', () => {
    let doc = createDesignCanvas(createDocument('Clear canvas', true));
    doc = addChild(
      doc,
      designCanvasContentRoot(doc)!,
      makeShapeNode(
        'art',
        { kind: 'rect', x: 0, y: 0, w: 320, h: 180 },
        { transform: [1, 0, 0, 1, 200, 100] },
      ),
    );
    const camera = computeFitActiveSurfaceCamera(doc, 'design', viewport, Math.PI / 4, {
      x: 0,
      y: 0,
      w: 1000,
      h: 600,
    })!;
    expect(camera.zoom).toBeCloseTo(520 / ((320 + 180) / Math.sqrt(2)));
    const [cx, cy] = worldToScreen(camera, 360, 190, viewport);
    expect(cx).toBeCloseTo(500);
    expect(cy).toBeCloseTo(300);
    for (const [x, y] of [
      [200, 100],
      [520, 100],
      [520, 280],
      [200, 280],
    ]) {
      const [sx, sy] = worldToScreen(camera, x!, y!, viewport);
      expect(sx).toBeGreaterThanOrEqual(39.99);
      expect(sx).toBeLessThanOrEqual(960.01);
      expect(sy).toBeGreaterThanOrEqual(39.99);
      expect(sy).toBeLessThanOrEqual(560.01);
    }
  });
});

// A panned-away-from-origin starting camera — the regression this guards
// against (EditorProvider's zoomIn anchoring around the viewport center vs.
// ViewportContext's naive `zoom * 1.25` leaving pan untouched) is invisible
// at zoom=1/pan=(0,0), since a naive scale about the origin and a
// center-anchored zoom coincide there.
const camState: EditorCameraState = { zoom: 1.5, pan: { x: 40, y: -25 }, cameraRotation: 0 };

// NOTE: these assertions deliberately stop short of checking that the world
// point under the viewport center is preserved (the actual purpose of
// anchoring zoom around the center). Investigating this test's failures
// surfaced a separate, pre-existing architectural gap in `zoomAboutPoint`
// (packages/shared/src/viewport.ts, see viewport.test.ts's
// 'zoomAboutPoint floating-origin edge cases' block): the floating-origin
// grid used for canvas numerical stability is recomputed fresh from
// scratch on every render call with no memory of the previously-used
// origin, so for a real fraction of zoom/pan/anchor combinations there is
// no pan value that keeps the anchor pixel-exact after the *next* render's
// origin recompute — an inherent ~1-grid-cell (zoom * 512px) jump, not a
// rounding error. zoomAboutPoint itself was fixed here (an actual bug: an
// 8-iteration convergence loop that could oscillate forever and fall back
// to an arbitrary answer — replaced with a deterministic closed-form
// calculation), but closing the remaining gap needs hysteretic origin
// tracking threaded through the render pipeline, out of scope for this
// module. What this module fixes is narrower — EditorProvider's
// `value.zoomIn/Out/To` and ViewportContext's `zoomIn/Out/To` now call the
// exact same function, so `useEditor()` and `useViewport()` can no longer
// disagree with *each other*, whatever zoomAboutPoint itself does.

describe('computeZoomStep', () => {
  it('changes zoom in the requested direction', () => {
    expect(computeZoomStep(camState, 'in', viewport).zoom).toBeGreaterThan(camState.zoom);
    expect(computeZoomStep(camState, 'out', viewport).zoom).toBeLessThan(camState.zoom);
  });

  it('does not merely scale the existing pan (the bug this replaces)', () => {
    // The naive `zoom: clampZoom(zoom * 1.25)` implementation ViewportContext
    // used to have left `pan` completely untouched — assert pan actually
    // moves to compensate, which is the behavioral difference that caused
    // useEditor().zoomIn() and useViewport().zoomIn() to disagree.
    const result = computeZoomStep(camState, 'in', viewport);
    expect(result.pan).not.toEqual(camState.pan);
  });

  it('is deterministic — same input always produces the same output', () => {
    // This is what actually closes the divergence: both call sites
    // (EditorProvider's value and ViewportContext) now call this one
    // function, so they're structurally guaranteed to agree.
    expect(computeZoomStep(camState, 'in', viewport)).toEqual(
      computeZoomStep(camState, 'in', viewport),
    );
  });
});

describe('computeZoomTo', () => {
  it('sets zoom to the clamped requested level', () => {
    expect(computeZoomTo(camState, 3, viewport).zoom).toBeCloseTo(3, 5);
  });

  it('does not merely scale the existing pan (the bug this replaces)', () => {
    const result = computeZoomTo(camState, 3, viewport);
    expect(result.pan).not.toEqual(camState.pan);
  });
});

describe('computeFitAllCamera', () => {
  /** A flat document (every node a direct child of contentRoot). */
  function makeFlatDoc(count: number) {
    const doc = createDocument('bench', {});
    const page = doc.pages![0]!;
    const contentRootId = page.contentRoot!;
    const contentRoot = doc.nodes[contentRootId]!;
    const nodes: Record<string, ReturnType<typeof makeShapeNode>> = {};
    const childIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `n-${i}`;
      nodes[id] = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 20, h: 16 },
        { transform: [1, 0, 0, 1, i * 24, 0] },
      );
      childIds.push(id);
    }
    return {
      ...doc,
      nodes: { ...doc.nodes, [contentRootId]: { ...contentRoot, children: childIds }, ...nodes },
    } as typeof doc;
  }

  it('frames every node in a small document', () => {
    const doc = makeFlatDoc(10);
    const cam = computeFitAllCamera(doc, viewport);
    expect(cam).not.toBeNull();
    expect(cam!.zoom).toBeGreaterThan(0);
  });

  it('reduces fit zoom for a rotated pasteboard footprint', () => {
    const doc = makeFlatDoc(10);
    const unrotated = computeFitAllCamera(doc, viewport, 0);
    const rotated = computeFitAllCamera(doc, viewport, Math.PI / 4);
    expect(unrotated).not.toBeNull();
    expect(rotated).not.toBeNull();
    expect(rotated!.rotation).toBeCloseTo(Math.PI / 4);
    expect(rotated!.pan).not.toEqual(unrotated!.pan);
  });

  it('returns null for a genuinely empty document', () => {
    const doc = createDocument('empty', {});
    expect(computeFitAllCamera(doc, viewport)).toBeNull();
  });

  it('scales near-linearly with node count, not quadratically', () => {
    // Regression guard: computeFitAllCamera calls nodeWorldBounds(doc, id)
    // once per node without a parentIndex, which falls back to an O(n)
    // linear scan (getParent) per call -- making document-open O(n^2).
    // Measured directly against a real Tauri/Chromium build: a 20,000-node
    // flat document pegged a CPU core at 96% for 10+ minutes without
    // finishing. A linear implementation should show roughly proportional
    // growth; a quadratic one grows an order of magnitude faster than the
    // node-count ratio. 8x nodes should cost nowhere near 8x^2 = 64x time.
    const small = makeFlatDoc(500);
    const large = makeFlatDoc(4000); // 8x the nodes

    const t0 = performance.now();
    computeFitAllCamera(small, viewport);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    computeFitAllCamera(large, viewport);
    const largeMs = performance.now() - t1;

    // Generous headroom (20x, not 8x) to avoid timer-noise flakiness while
    // still catching a reintroduced O(n^2), which would show ~64x+ growth.
    expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 200));
  });
});
