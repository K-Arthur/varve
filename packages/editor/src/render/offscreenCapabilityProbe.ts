/**
 * Verified OffscreenCanvas capability — presence is not usability.
 *
 * `typeof OffscreenCanvas !== 'undefined'` says an identifier is bound; it does
 * not say a worker can construct the surface, acquire a 2D context, produce an
 * ImageBitmap and hand it back with its pixels intact. Engines have shipped
 * partial implementations of exactly that chain, which is why the render-worker
 * eligibility gate was historically a blanket per-engine ban.
 *
 * This module replaces the ban with evidence: once per session, in a disposable
 * worker, draw four known-colour quadrants, read them back, transfer the bitmap
 * to the main thread and re-verify the pixels after compositing. The result is
 * cached for the session and read synchronously by the per-frame profile.
 *
 * The probe is bounded (one 8x8 surface, one round trip, a hard timeout) and
 * never runs per frame. Until it resolves, the capability is `unknown`, which
 * every caller must treat as "not verified" rather than "unsupported".
 */

import type { OffscreenProbeRequest, OffscreenProbeResponse } from './offscreenProbeWorker';

export type OffscreenCapability =
  /** The full construct → draw → transfer → verify chain succeeded. */
  | 'offscreen-supported'
  /** Workers exist but this engine cannot construct/serve an OffscreenCanvas. */
  | 'offscreen-api-present-but-broken'
  /** Drawing worked; moving the pixels to the main thread did not. */
  | 'offscreen-transfer-broken'
  /** No Worker or no OffscreenCanvas constructor at all. */
  | 'offscreen-worker-unavailable'
  /** Not probed yet, still in flight, or the probe timed out. */
  | 'offscreen-unknown';

export interface OffscreenProbeDetail {
  capability: OffscreenCapability;
  /** Which stage the worker reached, for diagnostics. */
  stage?: string;
  /** Wall time of the probe round trip. */
  durationMs?: number;
  /** Pixels verified on the main thread after the transfer. */
  mainThreadPixelsVerified?: boolean;
  error?: string;
}

const PROBE_SIZE = 8;
const PROBE_TIMEOUT_MS = 4000;

const EXPECTED: readonly [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];

let detail: OffscreenProbeDetail = { capability: 'offscreen-unknown' };
let inFlight: Promise<OffscreenProbeDetail> | null = null;

/** Synchronous read for the per-frame profile. Never triggers work. */
export function getOffscreenCapability(): OffscreenCapability {
  return detail.capability;
}

/** Full probe detail for diagnostics surfaces. */
export function getOffscreenProbeDetail(): OffscreenProbeDetail {
  return detail;
}

/** Reset probe state. Test seam only. */
export function _resetOffscreenCapability(): void {
  detail = { capability: 'offscreen-unknown' };
  inFlight = null;
}

/** Force a capability result without running a worker. Test seam only. */
export function _setOffscreenCapability(next: OffscreenProbeDetail): void {
  detail = next;
  inFlight = null;
}

function verifyOnMainThread(bitmap: ImageBitmap): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0);
  const q = Math.max(0, Math.floor(bitmap.width / 4));
  const t = Math.min(bitmap.width - 1, Math.floor((bitmap.width * 3) / 4));
  const points: readonly [number, number][] = [
    [q, q],
    [t, q],
    [q, t],
    [t, t],
  ];
  return points.every(([x, y], i) => {
    const expected = EXPECTED[i];
    if (!expected) return false;
    const d = ctx.getImageData(x, y, 1, 1).data;
    return (
      Math.abs((d[0] ?? -1) - expected[0]) <= 2 &&
      Math.abs((d[1] ?? -1) - expected[1]) <= 2 &&
      Math.abs((d[2] ?? -1) - expected[2]) <= 2 &&
      (d[3] ?? 0) >= 253
    );
  });
}

function classify(response: OffscreenProbeResponse): OffscreenCapability {
  switch (response.stage) {
    case 'no-offscreen-constructor':
      return 'offscreen-worker-unavailable';
    case 'construct-failed':
    case 'context-failed':
    case 'readback-failed':
    case 'readback-mismatch':
      return 'offscreen-api-present-but-broken';
    case 'transfer-failed':
      return 'offscreen-transfer-broken';
    case 'transferred':
      return 'offscreen-supported';
    default:
      return 'offscreen-unknown';
  }
}

/**
 * Run the probe once per session. Concurrent callers share one round trip.
 * Resolves to the cached detail; never rejects.
 */
export function probeOffscreenCapability(): Promise<OffscreenProbeDetail> {
  if (detail.capability !== 'offscreen-unknown') return Promise.resolve(detail);
  if (inFlight) return inFlight;

  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    detail = { capability: 'offscreen-worker-unavailable', stage: 'no-constructor' };
    return Promise.resolve(detail);
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;

  inFlight = new Promise<OffscreenProbeDetail>((resolve) => {
    let worker: Worker | null = null;
    let settled = false;

    const finish = (next: OffscreenProbeDetail): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The probe worker is disposable by construction: terminate it as soon
      // as the answer is known so it never outlives the question.
      try {
        worker?.terminate();
      } catch {
        // Terminating an already-dead worker is not an error worth reporting.
      }
      detail = {
        ...next,
        durationMs: typeof performance !== 'undefined' ? performance.now() - startedAt : undefined,
      };
      inFlight = null;
      resolve(detail);
    };

    const timer = setTimeout(() => {
      // A hung probe is not evidence of support. Leaving it `unknown` keeps
      // the conservative main-thread path.
      finish({ capability: 'offscreen-unknown', stage: 'timeout' });
    }, PROBE_TIMEOUT_MS);

    try {
      worker = new Worker(new URL('./offscreenProbeWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      finish({
        capability: 'offscreen-worker-unavailable',
        stage: 'worker-construct-failed',
        error: String(err),
      });
      return;
    }

    worker.onerror = () => {
      finish({ capability: 'offscreen-api-present-but-broken', stage: 'worker-error' });
    };

    worker.onmessage = (event: MessageEvent<OffscreenProbeResponse>) => {
      const response = event.data;
      if (response?.type !== 'probe-result') return;
      const capability = classify(response);
      if (capability !== 'offscreen-supported') {
        finish({ capability, stage: response.stage, error: response.error });
        return;
      }
      const bitmap = response.bitmap;
      if (!bitmap) {
        // The worker believed it transferred a bitmap and none arrived: the
        // transport is broken even though the draw path was not.
        finish({ capability: 'offscreen-transfer-broken', stage: 'bitmap-missing' });
        return;
      }
      let verified = false;
      try {
        verified = verifyOnMainThread(bitmap);
      } catch (err) {
        finish({
          capability: 'offscreen-transfer-broken',
          stage: 'main-verify-threw',
          error: String(err),
        });
        return;
      } finally {
        bitmap.close();
      }
      finish({
        capability: verified ? 'offscreen-supported' : 'offscreen-transfer-broken',
        stage: response.stage,
        mainThreadPixelsVerified: verified,
      });
    };

    const request: OffscreenProbeRequest = { type: 'probe', size: PROBE_SIZE };
    try {
      worker.postMessage(request);
    } catch (err) {
      finish({
        capability: 'offscreen-api-present-but-broken',
        stage: 'post-failed',
        error: String(err),
      });
    }
  });

  return inFlight;
}
