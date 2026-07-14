/**
 * Render worker entry — replays IR to OffscreenCanvas.
 * Supports pre-decoded ImageBitmaps via Structured Clone for image fills.
 */
import { type RenderItem, type ReplayTarget, replayIr } from '@strata/engine';
import { canvasBackingSize } from '../canvas/canvasSurface';
import { replaceImageBitmapMap } from './collectImageBitmaps';
import { applyWorkerCamera } from './workerCamera';
import type { WorkerCommand, WorkerResponse } from './workerHost';

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let activeDocVersion = 0;
/** Image fill bitmaps keyed by src URL, received via Structured Clone. */
let imageMap: Record<string, ImageBitmap> = {};

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    activeDocVersion = msg.docVersion;
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
    if (msg.docVersion < activeDocVersion) return;
    activeDocVersion = msg.docVersion;
    const backingWidth = canvasBackingSize(msg.viewport.width, msg.dpr);
    const backingHeight = canvasBackingSize(msg.viewport.height, msg.dpr);
    if (!canvas || !ctx || canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas = new OffscreenCanvas(backingWidth, backingHeight);
      ctx = canvas.getContext('2d');
    }
    if (!ctx) {
      post({
        type: 'error',
        message: 'OffscreenCanvas 2d unavailable',
        docVersion: msg.docVersion,
      });
      return;
    }
    // Update image map from Structured Clone transport
    if (msg.images) imageMap = replaceImageBitmapMap(imageMap, msg.images);
    try {
      ctx.setTransform(msg.dpr, 0, 0, msg.dpr, 0, 0);
      ctx.clearRect(0, 0, msg.viewport.width, msg.viewport.height);
      ctx.save();
      applyWorkerCamera(ctx, msg.camera, msg.dpr, msg.viewport);
      replayIr(ctx as unknown as ReplayTarget, msg.ir as RenderItem[], (src) => imageMap[src]);
      ctx.restore();
      if (msg.docVersion >= activeDocVersion) {
        const bitmap = canvas.transferToImageBitmap();
        post(
          {
            type: 'frameRendered',
            docVersion: msg.docVersion,
            camera: msg.camera,
            viewport: msg.viewport,
            dpr: msg.dpr,
            bitmap,
          },
          [bitmap],
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      post({ type: 'error', message: `render failed: ${detail}`, docVersion: msg.docVersion });
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
