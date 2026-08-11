// @vitest-environment jsdom
/**
 * Production-path regression: the dirty-diff baseline must advance to the
 * document a frame actually painted, even when that frame was overtaken by a
 * newer document mid-flight.
 *
 * Reproduction (real on desktop, where `buildIr` is a Tauri IPC await):
 *
 *   1. Frame 1 paints doc L (a rect at origin). Baseline: L.
 *   2. Frame 2 starts with doc A (the rect at an intermediate drag
 *      position) and blocks inside `await eng.buildIr(...)`.
 *   3. While blocked, the document changes to B (the rect deleted — the
 *      "delete while dragging" interaction).
 *   4. Frame 2 resolves and paints doc A anyway; the surface now shows A.
 *   5. Frame 3 runs with doc B and computes its damage by diffing
 *      `lastRenderedDocRef` against B.
 *
 * Pre-fix, `lastRenderedDocRef` only advanced when the painted doc was still
 * the current document, so frame 3 diffed L→B: the intermediate position A
 * painted is in neither L nor B, its pixels were never cleared, and the
 * deleted rect ghosted at the drag position forever.
 *
 * Post-fix, the baseline advances to the PAINTED doc (A), so frame 3 diffs
 * A→B and its clear rects cover every pixel A painted.
 *
 * This test drives the real `renderContent` with a controllable engine whose
 * `buildIr` promise the test holds open to force the overtake deterministically,
 * and asserts on the real clearRect calls the paint path issues.
 */

import type { Engine, RenderItem } from '@varve/engine';
import {
  addNode,
  buildAllVariantCaches,
  createDocument,
  makeShapeNode,
  resolveAllStyles,
} from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockupSurfaceCache } from '../../render/mockup/mockupIr';
import { createTransformCache, invalidateAll, invalidateNodes } from '../../scene/transformCache';
import { computeDocumentDirtyRegion, DirtyRegionRecorder } from '../dirtyRegion';
import { EngineNodeMemo } from '../engineNodeMemo';
import { computeInvalidationPlan } from '../invalidationPlan';
import { getMemoryBudgets } from '../memoryBudget';
import { createCanvasFrameKey } from '../perfRuntime';
import { createRedrawCoordinator } from '../redrawCoordinator';
import { type RenderContentDeps, renderContent } from '../renderPipeline';
import { NodeHashMemo, SubtreeIrCache } from '../subtreeIrCache';

type Document = import('@varve/scene').Document;
type EditorState = import('../../context').EditorState;
type EditorContextValue = import('../../context').EditorContextValue;
type CompositorBackend = import('@varve/compositor').CompositorBackend;

const CANVAS_W = 800;
const CANVAS_H = 600;

/** A rect node whose position differs per document. */
function rectDoc(x: number, y: number, keepNode = true): Document {
  let doc = createDocument('Baseline', true);
  doc = addNode(
    doc,
    makeShapeNode(
      'x',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
      { transform: [1, 0, 0, 1, x, y] as const },
    ),
  );
  if (!keepNode) {
    doc = {
      ...doc,
      nodes: Object.fromEntries(
        Object.entries(doc.nodes).filter(([id]) => id !== 'x'),
      ) as Document['nodes'],
      rootChildren: doc.rootChildren.filter((id) => id !== 'x'),
    };
  }
  return doc;
}

class ControllableEngine {
  backend = 'stub' as const;
  buildIrCalls = 0;
  private readonly pending: Array<{
    nodes: import('@varve/engine').SceneNode[];
    resolve: (ir: RenderItem[]) => void;
  }> = [];

  buildIr(scene: { nodes: import('@varve/engine').SceneNode[] }): Promise<RenderItem[]> {
    this.buildIrCalls++;
    return new Promise((resolve) => {
      this.pending.push({ nodes: scene.nodes, resolve });
    });
  }

  async hitTest(): Promise<number | null> {
    return null;
  }

  /** Resolve the oldest outstanding buildIr with a minimal per-node IR. */
  resolveNext(): void {
    const job = this.pending.shift();
    if (!job) throw new Error('no outstanding buildIr call');
    const ir: RenderItem[] = job.nodes.map((n) => {
      const transform = Array.from(
        (n as unknown as { transform: readonly number[] }).transform,
      ) as [number, number, number, number, number, number];
      return {
        transform,
        fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
        primitive: { kind: 'rect' as const, x: 0, y: 0, w: 40, h: 40 },
        opacity: 1,
        blendMode: 'normal' as const,
        strokes: [],
        effects: [],
      };
    });
    job.resolve(ir);
  }

  get outstanding(): number {
    return this.pending.length;
  }
}

interface Harness {
  engine: ControllableEngine;
  stateRef: { current: EditorState };
  paintedSurfaceRef: { current: import('../dirtyRegion').PaintedSurfaceIdentity | null };
  lastRenderedDocRef: { current: Document };
  drawInFlightRef: { current: boolean };
  dirtyRecorderRef: { current: DirtyRegionRecorder };
  subtreeIrCacheRef: { current: SubtreeIrCache };
  nodeHashMemoRef: { current: NodeHashMemo };
  engineNodeMemoRef: { current: EngineNodeMemo };
  drawPendingRef: { current: boolean };
  docVersionRef: { current: number };
  redrawCoordinatorRef: { current: ReturnType<typeof createRedrawCoordinator> | null };
  dirtyRectRef: { current: { x: number; y: number; w: number; h: number } | null };
  pendingPresentRef: { current: boolean };
  workerFailedRef: { current: boolean };
  sunkenColorRef: { current: string };
  transformCacheRef: { current: ReturnType<typeof createTransformCache> };
  mockupSurfaceCacheRef: { current: MockupSurfaceCache | null };
  prevCameraForRedrawRef: {
    current: { zoom: number; pan: { x: number; y: number }; rotation: number } | null;
  };
  prevImageCacheStampForRedrawRef: { current: number };
  prevFontLoadStampForRedrawRef: { current: number };
  contentDrawFrameKey: { current: string | null };
  requestContentDrawRef: { current: ((source: string, reason: string) => void) | null };
  compositor: CompositorBackend;
  clearCalls: number[][];
  canvas: HTMLCanvasElement;
}

function makeState(doc: Document): EditorState {
  return {
    document: doc,
    zoom: 1,
    pan: { x: 0, y: 0 },
    cameraRotation: 0,
    themeRevision: 0,
    canvasMode: 'full',
    showOriginalBgNodeId: null,
    motion: { isPlaying: false, currentTime: 0, activeTimelineId: null },
    media: { presentedStamp: 0 },
  } as unknown as EditorState;
}

function buildHarness(): Harness {
  const engine = new ControllableEngine();
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const parent = document.createElement('div');
  Object.defineProperty(parent, 'clientWidth', { configurable: true, value: CANVAS_W });
  Object.defineProperty(parent, 'clientHeight', { configurable: true, value: CANVAS_H });
  parent.appendChild(canvas);
  const compositor: CompositorBackend = {
    id: 'canvas2d',
    init: vi.fn(async () => {}),
    beginFrame: vi.fn(),
    drawVectorItems: vi.fn(),
    compositeRasterLayer: vi.fn(),
    endFrame: vi.fn(),
    destroy: vi.fn(),
  };
  // The jsdom setup stub creates a NEW context object per getContext call, so
  // a per-instance clearRect wrapper would only ever see one frame. Patch
  // getContext itself to wrap the clearRect of every context handed out.
  const clearCalls: number[][] = [];
  const originalGetContext = HTMLCanvasElement.prototype.getContext as unknown as (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ) => RenderingContext | null;
  const patchedGetContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    const ctx = originalGetContext.call(this, contextId, options);
    if (contextId === '2d' && ctx) {
      const c = ctx as unknown as CanvasRenderingContext2D;
      const originalClearRect = c.clearRect.bind(c);
      c.clearRect = ((x: number, y: number, w: number, h: number) => {
        clearCalls.push([x, y, w, h]);
        originalClearRect(x, y, w, h);
      }) as typeof c.clearRect;
    }
    return ctx;
  };
  HTMLCanvasElement.prototype.getContext =
    patchedGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;

  const stateRef: Harness['stateRef'] = { current: makeState(rectDoc(0, 0)) };
  const harness: Harness = {
    engine,
    stateRef,
    paintedSurfaceRef: { current: null },
    lastRenderedDocRef: { current: stateRef.current.document },
    drawInFlightRef: { current: false },
    dirtyRecorderRef: { current: new DirtyRegionRecorder() },
    subtreeIrCacheRef: { current: new SubtreeIrCache() },
    nodeHashMemoRef: { current: new NodeHashMemo() },
    engineNodeMemoRef: { current: new EngineNodeMemo(256) },
    drawPendingRef: { current: false },
    docVersionRef: { current: 0 },
    redrawCoordinatorRef: { current: createRedrawCoordinator() },
    dirtyRectRef: { current: null },
    pendingPresentRef: { current: false },
    workerFailedRef: { current: false },
    sunkenColorRef: { current: '#f4f2ef' },
    transformCacheRef: { current: createTransformCache() },
    mockupSurfaceCacheRef: { current: null },
    prevCameraForRedrawRef: { current: null },
    prevImageCacheStampForRedrawRef: { current: 0 },
    prevFontLoadStampForRedrawRef: { current: 0 },
    contentDrawFrameKey: { current: createCanvasFrameKey('test') },
    requestContentDrawRef: { current: null },
    compositor,
    clearCalls,
    canvas,
  };
  return harness;
}

function depsFor(h: Harness, doc: Document): RenderContentDeps {
  const stateRef = h.stateRef as React.MutableRefObject<EditorState>;
  const refs = {
    contentCanvasRef: { current: h.canvas } as React.RefObject<HTMLCanvasElement | null>,
    engineRef: { current: h.engine as unknown as Engine },
    compositorRef: { current: h.compositor },
    renderWorkerRef: { current: null },
    workerBitmapRef: { current: null },
    paintedSurfaceRef: h.paintedSurfaceRef as React.MutableRefObject<
      import('../dirtyRegion').PaintedSurfaceIdentity | null
    >,
    dirtyRecorderRef: h.dirtyRecorderRef as React.MutableRefObject<DirtyRegionRecorder>,
    subtreeIrCacheRef: h.subtreeIrCacheRef as React.MutableRefObject<SubtreeIrCache>,
    nodeHashMemoRef: h.nodeHashMemoRef as React.MutableRefObject<NodeHashMemo>,
    engineNodeMemoRef: h.engineNodeMemoRef as React.MutableRefObject<EngineNodeMemo>,
    drawInFlightRef: h.drawInFlightRef as React.MutableRefObject<boolean>,
    drawPendingRef: h.drawPendingRef as React.MutableRefObject<boolean>,
    lastRenderedDocRef: h.lastRenderedDocRef as React.MutableRefObject<Document>,
    docVersionRef: h.docVersionRef as React.MutableRefObject<number>,
    redrawCoordinatorRef: h.redrawCoordinatorRef as React.MutableRefObject<ReturnType<
      typeof createRedrawCoordinator
    > | null>,
    dirtyRectRef: h.dirtyRectRef as React.MutableRefObject<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>,
    pendingPresentRef: h.pendingPresentRef as React.MutableRefObject<boolean>,
    workerFailedRef: h.workerFailedRef as React.MutableRefObject<boolean>,
    sunkenColorRef: h.sunkenColorRef as React.MutableRefObject<string>,
    transformCacheRef: h.transformCacheRef as React.MutableRefObject<
      ReturnType<typeof createTransformCache>
    >,
    mockupSurfaceCacheRef:
      h.mockupSurfaceCacheRef as React.MutableRefObject<MockupSurfaceCache | null>,
    prevCameraForRedrawRef: h.prevCameraForRedrawRef as React.MutableRefObject<{
      zoom: number;
      pan: { x: number; y: number };
      rotation: number;
    } | null>,
    prevImageCacheStampForRedrawRef:
      h.prevImageCacheStampForRedrawRef as React.MutableRefObject<number>,
    prevFontLoadStampForRedrawRef:
      h.prevFontLoadStampForRedrawRef as React.MutableRefObject<number>,
    contentDrawFrameKey: h.contentDrawFrameKey as React.MutableRefObject<string | null>,
    requestContentDrawRef: h.requestContentDrawRef as React.MutableRefObject<
      ((source: string, reason: import('../redrawCoordinator').RedrawReason) => void) | null
    >,
    stateRef,
  };
  return {
    ...refs,
    displayDpr: 1,
    imageCacheStamp: 0,
    fontLoadStamp: 0,
    precomputedStyles: resolveAllStyles(doc),
    precomputedVariantCaches: buildAllVariantCaches(doc),
    budgets: getMemoryBudgets('high'),
    editor: { proofEnabled: false } as unknown as EditorContextValue,
    setCompositorDiagnostics: vi.fn(),
    scheduleDrawContent: vi.fn(),
  };
}

async function settle(h: Harness): Promise<void> {
  await vi.waitFor(
    () => {
      if (h.drawInFlightRef.current) throw new Error('frame still in flight');
    },
    { timeout: 5000 },
  );
  // A settled frame may have scheduled the pending-reschedule path; the
  // coordinator only decides on the next beginContentFrame, so nothing to drain.
}

/**
 * Mirror CanvasArea's doc-change bookkeeping (computeInvalidationPlan path):
 * docVersion bump plus transform-cache / subtree-IR-cache / engine-node-memo
 * invalidation. Without this, the transform cache serves the stale world
 * transform of the previous doc and the per-node IR cache reports false hits,
 * so buildIr is never called and the harness would not exercise the paint
 * path the test targets.
 */
function applyDocChange(h: Harness, next: Document): void {
  const prev = h.stateRef.current.document;
  if (prev === next) return;
  const plan = computeInvalidationPlan(prev, next);
  h.docVersionRef.current += 1;
  if (plan.isStructural) {
    invalidateAll(h.transformCacheRef.current);
    h.subtreeIrCacheRef.current.invalidate();
    h.engineNodeMemoRef.current.clear();
  } else {
    invalidateNodes(h.transformCacheRef.current, plan.changedIds);
    for (const id of plan.changedIds) {
      h.subtreeIrCacheRef.current.invalidate(id);
      h.engineNodeMemoRef.current.invalidate(id);
    }
  }
}

/** Run one frame to completion: call renderContent, resolve its buildIr, await paint. */
async function runFrame(h: Harness, doc: Document): Promise<void> {
  applyDocChange(h, doc);
  h.stateRef.current = makeState(doc);
  let syncError: unknown = null;
  try {
    renderContent(depsFor(h, doc));
  } catch (e) {
    syncError = e;
  }
  if (syncError) throw syncError;
  const outstanding = h.engine.outstanding;
  expect(outstanding).toBeGreaterThan(0);
  while (h.engine.outstanding > 0) {
    h.engine.resolveNext();
  }
  await settle(h);
}

describe('renderContent dirty-diff baseline (overtaken frame)', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advances the baseline to the painted doc so the next partial frame clears the ghost region', async () => {
    const L = rectDoc(0, 0); // rect rendered at the origin
    const A = rectDoc(200, 400); // intermediate drag position (painted, then overtaken)
    const B = rectDoc(200, 400, false); // rect deleted while frame 2 was in flight

    // Frame 1: doc L rendered and committed.
    await runFrame(h, L);
    expect(h.lastRenderedDocRef.current).toBe(L);
    // Precondition sanity: the partial diff from the last COMPLETED doc misses
    // the intermediate position — this is exactly the bug.
    const buggyDirty = computeDocumentDirtyRegion(L, B);
    expect(buggyDirty.kind).toBe('partial');
    if (buggyDirty.kind === 'partial') {
      expect(buggyDirty.bounds.x).toBeLessThanOrEqual(0);
      expect(buggyDirty.bounds.y).toBeLessThanOrEqual(0);
      expect(buggyDirty.bounds.w).toBeLessThan(240);
      expect(buggyDirty.bounds.h).toBeLessThan(440);
    }

    // Frame 2: starts with A, blocks in buildIr; the doc changes to B while
    // the frame is in flight (real on desktop: buildIr is a Tauri IPC await).
    applyDocChange(h, A);
    h.stateRef.current = makeState(A);
    renderContent(depsFor(h, A));
    expect(h.engine.outstanding).toBe(1);
    applyDocChange(h, B);
    h.stateRef.current = makeState(B);
    h.engine.resolveNext();
    await settle(h);
    // The frame painted A even though the document has moved on to B. The
    // surface now shows A's pixels, so the baseline must have advanced to A.
    expect(h.lastRenderedDocRef.current).toBe(A);

    // Frame 3: doc B — the damage diff must cover every pixel A painted,
    // i.e. the clear rects must cover the intermediate position (200,400,40,40).
    h.clearCalls.length = 0;
    await runFrame(h, B);
    expect(h.clearCalls.length).toBeGreaterThan(0);
    const coversGhost = h.clearCalls.some(
      ([x, y, w, d]) => x! <= 200 && y! <= 400 && x! + w! >= 240 && y! + d! >= 440,
    );
    expect(coversGhost, `clear rects: ${JSON.stringify(h.clearCalls)}`).toBe(true);
  });

  it('commits the baseline per painted frame across ordinary sequential frames', async () => {
    const L = rectDoc(0, 0);
    const M = rectDoc(100, 0);
    const N = rectDoc(100, 80);
    await runFrame(h, L);
    await runFrame(h, M);
    await runFrame(h, N);
    expect(h.lastRenderedDocRef.current).toBe(N);
    // Sequential frames diff against the immediately preceding painted doc.
    expect(computeDocumentDirtyRegion(M, N).kind).toBe('partial');
  });
});
