/**
 * Render worker entry — replays IR to OffscreenCanvas.
 */
import { type RenderItem, replayIr } from '@strata/engine';
import type { WorkerCommand, WorkerResponse } from './workerHost';

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let activeDocVersion = 0;

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    activeDocVersion = msg.docVersion;
    return;
  }
  if (msg.type === 'resize') {
    canvas = new OffscreenCanvas(Math.floor(msg.width * msg.dpr), Math.floor(msg.height * msg.dpr));
    ctx = canvas.getContext('2d');
    return;
  }
  if (msg.type === 'render') {
    if (msg.docVersion < activeDocVersion) return;
    activeDocVersion = msg.docVersion;
    if (!canvas || !ctx) {
      canvas = new OffscreenCanvas(
        Math.floor(msg.viewport.width * msg.dpr),
        Math.floor(msg.viewport.height * msg.dpr),
      );
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
    ctx.setTransform(msg.dpr, 0, 0, msg.dpr, 0, 0);
    ctx.clearRect(0, 0, msg.viewport.width, msg.viewport.height);
    ctx.save();
    ctx.translate(msg.camera.pan.x, msg.camera.pan.y);
    ctx.scale(msg.camera.zoom, msg.camera.zoom);
    replayIr(ctx, msg.ir as RenderItem[]);
    ctx.restore();
    if (msg.docVersion >= activeDocVersion) {
      const bitmap = canvas.transferToImageBitmap();
      post(
        {
          type: 'frameRendered',
          docVersion: msg.docVersion,
          camera: msg.camera,
          bitmap,
        },
        [bitmap],
      );
    }
    return;
  }
  if (msg.type === 'hitTest') {
    post({ type: 'hitTestResult', nodeId: null, docVersion: msg.docVersion });
  }
};

function post(response: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    self.postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}
