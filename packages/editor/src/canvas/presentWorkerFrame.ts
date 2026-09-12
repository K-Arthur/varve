/**
 * Present-only worker frame — the cheapest legitimate canvas frame.
 *
 * When the redraw coordinator decides a scheduled frame has no scene work but
 * a worker bitmap arrived since the last completed frame, the entire frame is
 * compositing that bitmap: identity transform, board fill, one drawImage.
 * No scene traversal, no IR build, no replay — the work that previously ran
 * as an unexplained full visible-list pass with `redrawReason: 'clean'`.
 */

import type { CompositorBackend } from '@varve/compositor';
import type { Affine } from '@varve/shared';
import { computeProfile } from './adaptiveProfile';
import { canvasBackingSize } from './canvasSurface';
import { endFrameTiming, getAverageFrameTime, getOverBudgetCount } from './frameBudget';
import { recordFrame } from './perfRuntime';
import type {
  FrameBeginDecision,
  FrameStateSnapshot,
  RedrawCoordinator,
} from './redrawCoordinator';

// Re-exported so CanvasArea's present path and fallback path share one
// decorations module without adding a hub-file import line (ADR-0144;
// CanvasArea is at its import budget).
export { drawPageDecorations } from './pageDecorations';

interface WorkerBitmapRecord {
  bitmap: ImageBitmap;
  docVersion: number;
  camera: { zoom: number; pan: { x: number; y: number }; rotation?: number };
  viewport: { width: number; height: number };
  dpr: number;
  rotation?: number;
}

export interface PresentWorkerFrameArgs {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  boardColor: string;
  wb: WorkerBitmapRecord | null;
  compositor: CompositorBackend | null;
  camera: { zoom: number; pan: { x: number; y: number }; rotation?: number };
  viewport: { width: number; height: number };
  dpr: number;
  docVersion: number;
  frameStart: number;
  /** Identity transform for the composited bitmap; defaults to identity. */
  identityTransform?: Affine;
  /**
   * Optional paint hook called between the board fill and the worker bitmap
   * composite. Page decorations (trim fills, shadows, labels) are not part
   * of the worker IR, so the present-only path must repaint them here or
   * they vanish whenever a presented frame replaces the surface.
   */
  paintUnderlays?: (ctx: CanvasRenderingContext2D) => void;
  coordinator: RedrawCoordinator;
  decision: FrameBeginDecision;
  snapshot: FrameStateSnapshot;
  cacheDiag: { bytes: number; entries: number };
}

/**
 * Composite the worker bitmap when it is still current (document, camera and
 * surface all match). Returns true when the frame was presented; false means
 * the bitmap is stale or absent, and the caller must fall through to a full
 * content pass.
 */
export function tryPresentWorkerFrame(args: PresentWorkerFrameArgs): boolean {
  const {
    ctx,
    canvas,
    boardColor,
    wb,
    compositor,
    camera,
    viewport,
    dpr,
    docVersion,
    identityTransform = [1, 0, 0, 1, 0, 0],
  } = args;
  if (!wb || !compositor) return false;
  // The bitmap is composited 1:1 into the backing store. Compare against the
  // actual backing-store size rather than the nominal DPR so an interactive
  // preview-scale surface still presents its matching bitmap (and a stale
  // preview bitmap is refused once the surface is promoted back to full
  // resolution).
  const surfaceMatches =
    canvas.width > 0 && canvas.height > 0
      ? canvasBackingSize(viewport.width, wb.dpr) === canvas.width &&
        canvasBackingSize(viewport.height, wb.dpr) === canvas.height
      : wb.dpr === dpr;
  const bitmapIsCurrent =
    wb.docVersion === docVersion &&
    wb.viewport.width === viewport.width &&
    wb.viewport.height === viewport.height &&
    surfaceMatches &&
    wb.camera.zoom === camera.zoom &&
    wb.camera.pan.x === camera.pan.x &&
    wb.camera.pan.y === camera.pan.y &&
    (wb.camera.rotation ?? 0) === (camera.rotation ?? 0);
  if (!bitmapIsCurrent) return false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = boardColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  args.paintUnderlays?.(ctx);
  compositor.compositeRasterLayer('worker-frame', wb.bitmap, identityTransform, 'normal');

  const budget = endFrameTiming(args.frameStart);
  recordFrame({
    frameIndex: docVersion,
    docVersion,
    redrawCount: args.coordinator.getDiagnostics().submittedFrames,
    nodeCount: 0,
    culledCount: 0,
    cacheHitCount: 0,
    buildIrMs: 0,
    hashMs: 0,
    replayMs: 0,
    engineNodeComputes: 0,
    engineNodeHits: 0,
    setupMs: 0,
    preLoopMs: 0,
    frameWorkClass: budget.workClass,
    frameWorkBudgetMs: budget.budgetMs,
    totalMs: budget.elapsedMs,
    renderPath: 'worker-cached',
    wasDirty: false,
    partialRedraw: false,
    cacheBytes: args.cacheDiag.bytes,
    cacheEntries: args.cacheDiag.entries,
    profileTier: computeProfile(getAverageFrameTime(), getOverBudgetCount(), 0).tier,
    // A present frame is never 'clean' — compositing the freshly arrived
    // worker bitmap IS its invalidation.
    redrawReason: args.decision.reasons[0] ?? 'worker-present',
    invalidationReasons: [...args.decision.reasons],
    frameSource: args.decision.explicit[0]?.source,
    dirtyAreaRatio: 0,
    dirtyRects: 0,
    dirtyScreenRect: undefined,
    frameDecision: args.decision.kind,
  });
  args.coordinator.completeFrame(args.decision, args.snapshot, {
    contentDrawn: false,
    fullRedraw: false,
  });
  return true;
}
