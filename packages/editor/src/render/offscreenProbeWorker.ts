/**
 * OffscreenCanvas capability probe — worker side.
 *
 * Deliberately tiny and dependency-free: it runs once per session in a
 * disposable worker to establish whether this engine can actually execute the
 * render-worker path, not merely whether the API names exist. Keeping it free
 * of imports also keeps it a single small bundled chunk.
 *
 * The probe draws four known-colour quadrants, reads them back inside the
 * worker, then transfers the resulting ImageBitmap to the main thread, which
 * verifies the pixels a second time after compositing. An engine that fails
 * any of these steps must never be handed a real frame.
 */

/** Quadrant colours the main thread re-verifies after the transfer. */
const QUADRANTS: readonly [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];

export interface OffscreenProbeRequest {
  type: 'probe';
  size: number;
}

export interface OffscreenProbeResponse {
  type: 'probe-result';
  /** Every stage that ran without throwing, in order. */
  stage:
    | 'no-offscreen-constructor'
    | 'construct-failed'
    | 'context-failed'
    | 'readback-failed'
    | 'readback-mismatch'
    | 'transfer-failed'
    | 'transferred';
  /** Samples read back inside the worker, before any transfer. */
  workerSamples?: number[][];
  bitmap?: ImageBitmap;
  error?: string;
}

function drawQuadrants(ctx: OffscreenCanvasRenderingContext2D, size: number): void {
  const half = Math.max(1, Math.floor(size / 2));
  const cells: readonly [number, number, number, number][] = [
    [0, 0, half, half],
    [half, 0, size - half, half],
    [0, half, half, size - half],
    [half, half, size - half, size - half],
  ];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const rgb = QUADRANTS[i];
    if (!cell || !rgb) continue;
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.fillRect(cell[0], cell[1], cell[2], cell[3]);
  }
}

function sampleQuadrants(ctx: OffscreenCanvasRenderingContext2D, size: number): number[][] {
  const q = Math.max(0, Math.floor(size / 4));
  const t = Math.min(size - 1, Math.floor((size * 3) / 4));
  const points: readonly [number, number][] = [
    [q, q],
    [t, q],
    [q, t],
    [t, t],
  ];
  return points.map(([x, y]) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
  });
}

function samplesMatch(samples: number[][]): boolean {
  return samples.every((px, i) => {
    const expected = QUADRANTS[i];
    if (!expected || px.length < 4) return false;
    // Exact colours on an opaque surface; a small tolerance absorbs only
    // colour-space rounding, never a wrong quadrant.
    return (
      Math.abs((px[0] ?? -1) - expected[0]) <= 2 &&
      Math.abs((px[1] ?? -1) - expected[1]) <= 2 &&
      Math.abs((px[2] ?? -1) - expected[2]) <= 2 &&
      (px[3] ?? 0) >= 253
    );
  });
}

function post(response: OffscreenProbeResponse, transfer?: Transferable[]): void {
  const scope = self as unknown as {
    postMessage: (msg: OffscreenProbeResponse, transfer?: Transferable[]) => void;
  };
  if (transfer?.length) scope.postMessage(response, transfer);
  else scope.postMessage(response);
}

self.onmessage = (event: MessageEvent<OffscreenProbeRequest>): void => {
  const size = Math.max(2, Math.min(64, event.data?.size ?? 8));
  try {
    if (typeof OffscreenCanvas === 'undefined') {
      post({ type: 'probe-result', stage: 'no-offscreen-constructor' });
      return;
    }
    let canvas: OffscreenCanvas;
    try {
      canvas = new OffscreenCanvas(size, size);
    } catch (err) {
      post({ type: 'probe-result', stage: 'construct-failed', error: String(err) });
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      post({ type: 'probe-result', stage: 'context-failed' });
      return;
    }

    drawQuadrants(ctx, size);

    let workerSamples: number[][];
    try {
      workerSamples = sampleQuadrants(ctx, size);
    } catch (err) {
      post({ type: 'probe-result', stage: 'readback-failed', error: String(err) });
      return;
    }
    if (!samplesMatch(workerSamples)) {
      post({ type: 'probe-result', stage: 'readback-mismatch', workerSamples });
      return;
    }

    // transferToImageBitmap is the step that actually moves pixels across the
    // thread boundary — the one an engine is most likely to stub out.
    if (typeof canvas.transferToImageBitmap !== 'function') {
      post({ type: 'probe-result', stage: 'transfer-failed', workerSamples });
      return;
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = canvas.transferToImageBitmap();
    } catch (err) {
      post({
        type: 'probe-result',
        stage: 'transfer-failed',
        workerSamples,
        error: String(err),
      });
      return;
    }
    // The bitmap must be referenced in the payload as well as the transfer
    // list: the transfer list moves ownership, the receiver reads the payload.
    post({ type: 'probe-result', stage: 'transferred', workerSamples, bitmap }, [bitmap]);
  } catch (err) {
    post({ type: 'probe-result', stage: 'construct-failed', error: String(err) });
  }
};
