/**
 * Render-path diagnostics — which backend actually draws, and why.
 *
 * Before this module the only observable facts were "a worker host exists" and
 * "`OffscreenCanvas` is defined", neither of which answers the question that
 * matters when a user reports canvas lag: *is this runtime rendering on the
 * main thread, and if so which gate put it there?* The eligibility chain has
 * several independent gates (profile tier, engine policy, verified capability,
 * scene compatibility, structural compositing, bitmap budget, host creation)
 * and any one of them silently selects the main-thread path.
 *
 * The diagnostic is **pull-based**: nothing is recorded per frame, so tracing
 * costs nothing when nobody is looking. Callers compose a snapshot on demand
 * from the capability cache, the eligibility decision and the observed frame
 * history. This is developer diagnostics — it never raises a user-facing
 * banner just because the worker path is unavailable.
 */

export type CanvasRenderPath =
  | 'main-canvas2d'
  | 'worker-offscreen-canvas2d'
  | 'webgpu'
  | 'webgl'
  | 'native'
  | 'fallback';

export type RenderPathFallbackReason =
  | 'none'
  | 'worker-unavailable'
  | 'offscreen-unavailable'
  | 'offscreen-unverified'
  | 'webkit-policy'
  | 'profile-tier'
  | 'scene-incompatible'
  | 'structural-compositing'
  | 'budget'
  | 'worker-failed'
  | 'gpu-unavailable'
  | 'unknown';

export interface RenderPathDiagnostic {
  /** Backend the profile would use if every gate passed. */
  requestedBackend: CanvasRenderPath;
  /** Backend actually executing frames, as observed. */
  actualBackend: CanvasRenderPath;

  workerAvailable: boolean;
  offscreenCanvasAvailable: boolean;
  /** Verified by running the real chain, not merely present as an identifier. */
  offscreenCanvasVerified: boolean;
  workerPolicyAllowed: boolean;

  fallbackReason: RenderPathFallbackReason;

  engine: string;
  /**
   * UA-reported WebKit token. Recorded for completeness and explicitly NOT
   * used for gating: WebKitGTK reports the frozen Safari-compatibility value
   * (605.1.15) regardless of the real library version.
   */
  engineVersionToken?: string;
  offscreenCapability: string;
  /** Whether a render-worker host object currently exists. */
  workerHostCreated: boolean;

  /** Frame attribution observed from the diagnostics ring (?perf=1 only). */
  observedWorkerFrames: number;
  observedMainThreadFrames: number;
}

export interface RenderPathInputs {
  engine: string;
  engineVersionToken?: string;
  hasWorker: boolean;
  hasOffscreenCanvas: boolean;
  hasWebGPU: boolean;
  offscreenCapability: string;
  eligibility: { allowed: boolean; reason: RenderPathFallbackReason };
  workerHostCreated: boolean;
  /** Render paths of recent frames, newest last. */
  recentFramePaths: readonly string[];
}

/**
 * Compose the current render-path picture. Pure: every input is supplied by
 * the caller, so this is safe to call from a diagnostics getter or a test.
 */
export function resolveRenderPathDiagnostic(inputs: RenderPathInputs): RenderPathDiagnostic {
  const workerFrames = inputs.recentFramePaths.filter(
    (p) => p === 'worker' || p === 'worker-cached',
  ).length;
  const mainFrames = inputs.recentFramePaths.length - workerFrames;

  // "Actual" is observation first, capability second: if frames have been
  // seen, they are the answer; otherwise report what the gates would select.
  const actualBackend: CanvasRenderPath =
    workerFrames > 0 && workerFrames >= mainFrames
      ? 'worker-offscreen-canvas2d'
      : inputs.recentFramePaths.length > 0
        ? 'main-canvas2d'
        : inputs.eligibility.allowed && inputs.workerHostCreated
          ? 'worker-offscreen-canvas2d'
          : 'main-canvas2d';

  return {
    requestedBackend: inputs.eligibility.allowed ? 'worker-offscreen-canvas2d' : 'main-canvas2d',
    actualBackend,
    workerAvailable: inputs.hasWorker,
    offscreenCanvasAvailable: inputs.hasOffscreenCanvas,
    offscreenCanvasVerified: inputs.offscreenCapability === 'offscreen-supported',
    workerPolicyAllowed: inputs.eligibility.allowed,
    fallbackReason: inputs.eligibility.reason,
    engine: inputs.engine,
    engineVersionToken: inputs.engineVersionToken,
    offscreenCapability: inputs.offscreenCapability,
    workerHostCreated: inputs.workerHostCreated,
    observedWorkerFrames: workerFrames,
    observedMainThreadFrames: mainFrames,
  };
}

/**
 * One-line human summary, e.g.
 * `webkit -> main-canvas2d (webkit-policy)`.
 */
export function describeRenderPath(d: RenderPathDiagnostic): string {
  const reason = d.fallbackReason === 'none' ? '' : ` (${d.fallbackReason})`;
  return `${d.engine} -> ${d.actualBackend}${reason}`;
}
