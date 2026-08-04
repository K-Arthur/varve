/**
 * Apply the same camera contract in the render worker as on the main thread.
 * Keeping this pure makes rotation, zoom, pan, DPR, and future camera changes
 * independently testable without booting a Worker global.
 */

import type { Affine, Camera, Viewport } from '@varve/shared';
import {
  applyCameraTransform,
  buildWorldToScreenAffine,
  computeFloatingOrigin,
  multiplyAffine,
  tryInvertAffine,
} from '@varve/shared';

export interface WorkerCameraTarget {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
}

export function applyWorkerCamera(
  target: WorkerCameraTarget,
  camera: Camera,
  dpr: number,
  viewport: Viewport,
): void {
  applyCameraTransform(target, camera, dpr, viewport, computeFloatingOrigin(camera, viewport));
}

/** Map a cached worker bitmap into a new camera without re-rendering it. */
export function workerBitmapDelta(
  previous: Camera,
  next: Camera,
  viewport: Viewport,
  dpr: number,
): Affine | null {
  const previousInverse = tryInvertAffine(buildWorldToScreenAffine(previous, viewport));
  if (!previousInverse) return null;
  const cssDelta = multiplyAffine(buildWorldToScreenAffine(next, viewport), previousInverse);
  return [cssDelta[0], cssDelta[1], cssDelta[2], cssDelta[3], cssDelta[4] * dpr, cssDelta[5] * dpr];
}
