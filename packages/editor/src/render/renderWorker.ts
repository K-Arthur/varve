/**
 * Render worker entry — replays IR to OffscreenCanvas.
 * Supports pre-decoded ImageBitmaps via Structured Clone for image fills.
 */
import { type RenderItem, type ReplayTarget, replayIr } from '@varve/engine';
import { setRasterPyramidEnabled } from '@varve/engine/rasterPyramid';
import { asRenderRevision } from '@varve/shared';
import { canvasBackingSize } from '../canvas/canvasSurface';
import { closeImageBitmapMap, reconcileImageBitmapMap } from './collectImageBitmaps';
import { applyProofToIr } from './proofing';
import { shouldTransferRenderedFrame } from './renderWorkerGuards';
import { applyWorkerCamera } from './workerCamera';
import type { WorkerCommand, WorkerRenderTiming, WorkerResponse } from './workerHost';

// The worker is the primary display path; the raster LOD pyramid (ADR-0214)
// is a display acceleration structure, so it is on by default in this realm
// (per-realm flag — the main thread's session enable/disable is mirrored
// through the setRasterLod command for the visual corpus).
setRasterPyramidEnabled(true);

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let activeRenderRevision = asRenderRevision(0);
/** Image fill bitmaps keyed by src URL, received via Structured Clone. */
let imageMap: Record<string, ImageBitmap> = {};
/**
 * Per-render timing is only collected while the host has tracing on, so the
 * untraced hot path keeps its original three `performance.now()`-free shape.
 * Flipped by the host's clock-calibration ping, which it only sends when
 * interaction tracing is enabled.
 */
let timingEnabled = false;

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data;
  const receivedAt = timingEnabled || msg.type === 'clockPing' ? performance.now() : 0;
  if (msg.type === 'setRasterLod') {
    setRasterPyramidEnabled(msg.enabled);
    return;
  }
  if (msg.type === 'clockPing') {
    timingEnabled = true;
    // t2 is read as late as possible so the reported worker interval covers
    // the whole time the message spent in this handler.
    post({ type: 'clockPong', seq: msg.seq, t0: msg.t0, t1: receivedAt, t2: performance.now() });
    return;
  }
  if (msg.type === 'cancel') {
    activeRenderRevision = msg.renderRevision ?? asRenderRevision(msg.docVersion);
    return;
  }
  if (msg.type === 'resize') {
    canvas = new OffscreenCanvas(
      canvasBackingSize(msg.width, msg.dpr),
      canvasBackingSize(msg.height, msg.dpr),
    );
    ctx = canvas.getContext('2d');
    return;
  }
  if (msg.type === 'render') {
    const renderRevision = msg.renderRevision ?? asRenderRevision(msg.docVersion);
    if (renderRevision < activeRenderRevision) {
      if (msg.images) closeImageBitmapMap(msg.images);
      return;
    }
    activeRenderRevision = renderRevision;
    const surfaceStart = timingEnabled ? performance.now() : 0;
    const backingWidth = canvasBackingSize(msg.viewport.width, msg.dpr);
    const backingHeight = canvasBackingSize(msg.viewport.height, msg.dpr);
    if (!canvas || !ctx || canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas = new OffscreenCanvas(backingWidth, backingHeight);
      ctx = canvas.getContext('2d');
    }
    const surfaceMs = timingEnabled ? performance.now() - surfaceStart : 0;
    if (!ctx) {
      if (msg.images) closeImageBitmapMap(msg.images);
      post({
        type: 'error',
        message: 'OffscreenCanvas 2d unavailable',
        docVersion: msg.docVersion,
        renderRevision,
      });
      return;
    }
    // Apply only newly required resources and prune sources absent from the
    // authoritative manifest. Legacy full-map commands remain supported.
    if (msg.images || msg.imageSources) {
      imageMap = reconcileImageBitmapMap(
        imageMap,
        msg.images ?? {},
        msg.imageSources ?? Object.keys(msg.images ?? imageMap),
      );
    }
    // Resident source bytes are reported on every frame (cheap map walk) so
    // the host can account worker-held decoded bitmaps and include them in
    // admission control — never relying on GC to define ImageBitmap lifetime.
    let imageBytes = 0;
    for (const bmp of Object.values(imageMap)) {
      imageBytes += bmp.width * bmp.height * 4;
    }
    try {
      const renderStartedAt = timingEnabled ? performance.now() : 0;
      ctx.setTransform(msg.dpr, 0, 0, msg.dpr, 0, 0);
      ctx.clearRect(0, 0, msg.viewport.width, msg.viewport.height);
      ctx.save();
      try {
        applyWorkerCamera(ctx, msg.camera, msg.dpr, msg.viewport);
        // Soft proofing: display-only transform applied before replay. Never
        // mutates document colors and never runs for exports.
        const ir = msg.proof
          ? applyProofToIr(msg.ir as RenderItem[], msg.proof)
          : (msg.ir as RenderItem[]);
        replayIr(ctx as unknown as ReplayTarget, ir, (src) => imageMap[src]);
      } finally {
        ctx.restore();
      }
      const renderEndedAt = timingEnabled ? performance.now() : 0;
      if (shouldTransferRenderedFrame(renderRevision, activeRenderRevision)) {
        const bitmap = canvas.transferToImageBitmap();
        const postedAt = timingEnabled ? performance.now() : 0;
        const timing: WorkerRenderTiming | undefined = timingEnabled
          ? {
              receivedAt,
              renderStartedAt,
              renderEndedAt,
              postedAt,
              surfaceMs,
              replayMs: renderEndedAt - renderStartedAt,
              bitmapMs: postedAt - renderEndedAt,
              irCount: msg.ir.length,
              imageCount: Object.keys(imageMap).length,
            }
          : undefined;
        post(
          {
            type: 'frameRendered',
            docVersion: msg.docVersion,
            renderRevision,
            camera: msg.camera,
            viewport: msg.viewport,
            dpr: msg.dpr,
            bitmap,
            imageBytes,
            ...(timing ? { timing } : {}),
          },
          [bitmap],
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      post({
        type: 'error',
        message: `render failed: ${detail}`,
        docVersion: msg.docVersion,
        renderRevision,
      });
    }
    return;
  }
  if (msg.type === 'hitTest') {
    post({ type: 'hitTestResult', nodeId: null, docVersion: msg.docVersion });
  }
};

function post(response: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    (
      self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }
    ).postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}
