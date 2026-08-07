/**
 * WebKitGTK OffscreenCanvas capability probe — worker side.
 * Works as both a classic and a module worker (no import/export syntax).
 */

let canvas = null;
let ctx = null;

/** Representative Varve-style replay: rects, paths, gradients, text, transforms. */
function replayRepresentative(c, w, h, seed) {
  c.save();
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#101418';
  c.fillRect(0, 0, w, h);
  // Solid rects
  for (let i = 0; i < 40; i++) {
    c.fillStyle = i % 2 ? '#2ec4b6' : '#e71d36';
    c.fillRect((i * 37 + seed) % w, (i * 53) % h, 24, 18);
  }
  // Path + stroke + transform
  c.save();
  c.translate(w / 2, h / 2);
  c.rotate((seed % 360) * (Math.PI / 180));
  c.beginPath();
  c.moveTo(-60, -40);
  c.bezierCurveTo(-20, -90, 40, 60, 70, -10);
  c.lineWidth = 4;
  c.lineJoin = 'round';
  c.strokeStyle = '#ffd166';
  c.stroke();
  c.restore();
  // Gradient fill
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(46,196,182,0.7)');
  g.addColorStop(1, 'rgba(231,29,54,0.2)');
  c.fillStyle = g;
  c.fillRect(w * 0.1, h * 0.6, w * 0.5, h * 0.25);
  // Global alpha + composite
  c.globalAlpha = 0.6;
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#118ab2';
  c.fillRect(w * 0.3, h * 0.1, w * 0.3, h * 0.3);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  // Text
  c.fillStyle = '#f8f9fa';
  c.font = '16px sans-serif';
  c.fillText('varve probe ' + seed, 12, 24);
  c.restore();
}

/** Draw an exactly-verifiable pattern: 4 known-colour quadrants. */
function drawKnownPixels(c, w, h) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  c.fillStyle = 'rgb(255,0,0)';
  c.fillRect(0, 0, hw, hh);
  c.fillStyle = 'rgb(0,255,0)';
  c.fillRect(hw, 0, w - hw, hh);
  c.fillStyle = 'rgb(0,0,255)';
  c.fillRect(0, hh, hw, h - hh);
  c.fillStyle = 'rgb(255,255,0)';
  c.fillRect(hw, hh, w - hw, h - hh);
}

function ensureCanvas(w, h) {
  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext('2d');
    return 'created';
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    // Resizing an OffscreenCanvas resets the context state; re-acquire is not
    // required by spec but is recorded so a divergence here is visible.
    return 'resized';
  }
  return 'reused';
}

self.onmessage = (e) => {
  const msg = e.data;
  const reply = { type: msg.type, ok: false };
  try {
    if (msg.type === 'env') {
      reply.ok = true;
      reply.offscreenCanvasType = typeof OffscreenCanvas;
      reply.createImageBitmapType = typeof createImageBitmap;
      reply.imageBitmapType = typeof ImageBitmap;
      reply.offscreenCanvasRenderingContext2DType = typeof OffscreenCanvasRenderingContext2D;
      self.postMessage(reply);
      return;
    }

    if (msg.type === 'construct') {
      const state = ensureCanvas(msg.width, msg.height);
      reply.surfaceState = state;
      reply.canvasWidth = canvas.width;
      reply.canvasHeight = canvas.height;
      reply.contextAcquired = !!ctx;
      reply.contextCtor = ctx ? ctx.constructor.name : null;
      reply.ok = !!ctx;
      self.postMessage(reply);
      return;
    }

    if (msg.type === 'knownPixels') {
      ensureCanvas(msg.width, msg.height);
      drawKnownPixels(ctx, msg.width, msg.height);
      // Verify inside the worker via getImageData before any transfer.
      const probe = [
        ctx.getImageData(Math.floor(msg.width * 0.25), Math.floor(msg.height * 0.25), 1, 1).data,
        ctx.getImageData(Math.floor(msg.width * 0.75), Math.floor(msg.height * 0.25), 1, 1).data,
        ctx.getImageData(Math.floor(msg.width * 0.25), Math.floor(msg.height * 0.75), 1, 1).data,
        ctx.getImageData(Math.floor(msg.width * 0.75), Math.floor(msg.height * 0.75), 1, 1).data,
      ].map((d) => [d[0], d[1], d[2], d[3]]);
      reply.workerSamples = probe;
      reply.ok = true;
      self.postMessage(reply);
      return;
    }

    if (msg.type === 'transferKnown') {
      ensureCanvas(msg.width, msg.height);
      drawKnownPixels(ctx, msg.width, msg.height);
      const bmp = canvas.transferToImageBitmap();
      reply.ok = true;
      reply.bitmapWidth = bmp.width;
      reply.bitmapHeight = bmp.height;
      // The bitmap must be referenced in the payload as well as the transfer
      // list — the transfer list only moves ownership, the receiver reads it
      // from the message. This mirrors WorkerResponse.bitmap in workerHost.ts.
      reply.bitmap = bmp;
      self.postMessage(reply, [bmp]);
      return;
    }

    if (msg.type === 'frames') {
      const w = msg.width;
      const h = msg.height;
      ensureCanvas(w, h);
      const n = msg.count;
      const replayTimes = [];
      const bitmapTimes = [];
      let lastBitmap = null;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const a = performance.now();
        replayRepresentative(ctx, w, h, i);
        const b = performance.now();
        const bmp = canvas.transferToImageBitmap();
        const c = performance.now();
        replayTimes.push(b - a);
        bitmapTimes.push(c - b);
        // Close every frame except the last, mirroring latest-only presentation.
        if (lastBitmap) lastBitmap.close();
        lastBitmap = bmp;
      }
      const total = performance.now() - t0;
      reply.ok = true;
      reply.count = n;
      reply.totalMs = total;
      reply.replayTimes = replayTimes;
      reply.bitmapTimes = bitmapTimes;
      reply.bitmapWidth = lastBitmap ? lastBitmap.width : 0;
      reply.bitmapHeight = lastBitmap ? lastBitmap.height : 0;
      if (lastBitmap) {
        reply.bitmap = lastBitmap;
        self.postMessage(reply, [lastBitmap]);
      } else {
        self.postMessage(reply);
      }
      return;
    }

    if (msg.type === 'resize') {
      const state = ensureCanvas(msg.width, msg.height);
      drawKnownPixels(ctx, msg.width, msg.height);
      const bmp = canvas.transferToImageBitmap();
      reply.ok = true;
      reply.surfaceState = state;
      reply.bitmapWidth = bmp.width;
      reply.bitmapHeight = bmp.height;
      reply.bitmap = bmp;
      self.postMessage(reply, [bmp]);
      return;
    }

    reply.error = 'unknown message type ' + msg.type;
    self.postMessage(reply);
  } catch (err) {
    reply.ok = false;
    reply.error = String((err && err.stack) || err);
    self.postMessage(reply);
  }
};

self.postMessage({ type: 'ready', ok: true });
