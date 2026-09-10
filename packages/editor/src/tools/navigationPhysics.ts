/**
 * Shared elapsed-time physics for viewport navigation.
 *
 * Velocities use CSS pixels per second. Direct pointer tracking does not use
 * this module; it is only for inertial continuation and time-based auto-pan.
 */

export const REFERENCE_FRAME_MS = 1000 / 60;
export const MAX_NAVIGATION_STEP_MS = 50;

export interface NavigationVelocity {
  x: number;
  y: number;
}

export interface DecayedMotionStep {
  delta: NavigationVelocity;
  velocity: NavigationVelocity;
  stopped: boolean;
}

/** Convert a legacy/reference-frame displacement into CSS pixels per second. */
export function frameDisplacementToVelocity(displacement: number): number {
  return displacement * (1000 / REFERENCE_FRAME_MS);
}

/**
 * Convert a retention factor specified at 60 Hz into an exponential decay
 * rate. The resulting motion has the same half-life at every refresh rate.
 */
export function decayRateFromFrameRetention(retention: number): number {
  const bounded = Math.max(Number.EPSILON, Math.min(1, retention));
  return -Math.log(bounded) / (REFERENCE_FRAME_MS / 1000);
}

/**
 * Resolve elapsed time for a scheduled navigation frame. The first frame uses
 * one reference interval. Non-monotonic clocks use the same safe fallback,
 * while long gaps are clamped so tab restore cannot apply a large jump.
 */
export function navigationFrameDeltaMs(
  previousFrameTimeMs: number | null,
  frameTimeMs: number,
  maxStepMs: number = MAX_NAVIGATION_STEP_MS,
): number {
  if (previousFrameTimeMs === null) return REFERENCE_FRAME_MS;
  const elapsed = frameTimeMs - previousFrameTimeMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return REFERENCE_FRAME_MS;
  return Math.min(elapsed, Math.max(REFERENCE_FRAME_MS, maxStepMs));
}

/** Integrate constant screen-space velocity for one bounded frame. */
export function integrateVelocity(
  velocity: NavigationVelocity,
  elapsedMs: number,
): NavigationVelocity {
  const seconds = Math.max(0, elapsedMs) / 1000;
  return { x: velocity.x * seconds, y: velocity.y * seconds };
}

/**
 * Integrate exponential velocity decay exactly over `elapsedMs`. Exact
 * integration avoids the refresh-dependent travel error of Euler updates.
 */
export function stepDecayedMotion(
  velocity: NavigationVelocity,
  elapsedMs: number,
  decayRatePerSecond: number,
  stopSpeedPxPerSecond: number,
): DecayedMotionStep {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const rate = Math.max(Number.EPSILON, decayRatePerSecond);
  const retention = Math.exp(-rate * seconds);
  const nextVelocity = {
    x: velocity.x * retention,
    y: velocity.y * retention,
  };
  const distanceFactor = (1 - retention) / rate;
  const delta = {
    x: velocity.x * distanceFactor,
    y: velocity.y * distanceFactor,
  };
  const stopped =
    Math.abs(nextVelocity.x) < stopSpeedPxPerSecond &&
    Math.abs(nextVelocity.y) < stopSpeedPxPerSecond;
  return {
    delta,
    velocity: stopped ? { x: 0, y: 0 } : nextVelocity,
    stopped,
  };
}

/** Reduced motion disables nonessential inertial continuation, not direct input. */
export function prefersReducedNavigationMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
