/**
 * Diagnostics overlay for canvas draw timing and correctness.
 *
 * Collects per-frame metrics in a ring buffer and exposes them for a
 * <canvas> overlay or console inspection. Off by default everywhere
 * (including dev builds) — callers opt in explicitly, normally driven by
 * the persisted `performance.showPerformanceDiagnostics` setting (see
 * Settings > Performance > Diagnostics).
 */

export interface FrameDiagnostics {
  frameIndex: number;
  docVersion: number;
  redrawCount: number;
  nodeCount: number;
  culledCount: number;
  cacheHitCount: number;
  buildIrMs: number;
  replayMs: number;
  /** performance.now() at recordFrame time — lets probes measure input→paint
   * latency (dispatch a pointer event, then read the first frame's committedAt). */
  committedAt?: number;
  /**
   * Time spent in the per-node content-hash loop (cacheContentParts +
   * SubtreeIrCache.nodeHash + cache lookup) that runs before buildIr. This cost
   * sits inside the frame (totalMs) but OUTSIDE buildIrMs/replayMs, so without
   * this field it is invisible — exactly the blind spot where the full-image-src
   * hashing regression hid. Optional so pre-existing frame records stay valid.
   */
  hashMs?: number;
  /**
   * Scene→engine node conversions performed this frame (`toEngineNode` calls)
   * and reuses served by EngineNodeMemo. On a steady frame these should be 0
   * and `nodeCount` respectively; during a single-node drag, 1 and nodeCount-1.
   * A conversion count that tracks nodeCount means the memo is being defeated —
   * this is the work-count signal the perf probes assert on, because it is
   * deterministic and therefore immune to machine load. Optional so
   * pre-existing frame records stay valid.
   */
  engineNodeComputes?: number;
  engineNodeHits?: number;
  /**
   * Frame time before the per-node loop: walkNodes, the container-culling
   * pass, dirty-region and style/variant precomputation.
   */
  setupMs?: number;
  /**
   * The per-node flatNodes loop (effective-node resolution, bindings, cached
   * world geometry, viewport cull, engine-node conversion or memo hit).
   *
   * setupMs + preLoopMs + hashMs + buildIrMs + replayMs is deliberately less
   * than totalMs: the remainder is post-replay work (compositing, overlays,
   * worker dispatch). Keeping these phases separate is what turned "the frame
   * costs 60ms and we cannot see why" into a locatable cost.
   */
  preLoopMs?: number;
  totalMs: number;
  renderPath: 'structural' | 'worker' | 'worker-cached' | 'compositor';
  wasDirty: boolean;
  partialRedraw: boolean;
  cacheBytes: number;
  cacheEntries: number;
  profileTier: string;
}

const MAX_DIAG_FRAMES = 120;
const diagRing: FrameDiagnostics[] = [];
let diagEnabled = false;

export function enableDrawDiagnostics(force?: boolean): void {
  diagEnabled = force === true;
}

export function isDiagnosticsEnabled(): boolean {
  return diagEnabled;
}

/**
 * Install a benchmark-only window handle so E2E/perf harnesses can read the
 * frame diagnostics ring buffer without console flooding. Gated to explicit
 * `?perf=1` opt-in (which also enables the ring buffer) so normal usage never
 * pays for it and the handle is inert (never installed) otherwise. Exposed as
 * `window.__strataPerf`.
 */
export function installPerfDiagnosticsHandle(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.search.includes('perf=1')) return;
  const globalThisAny = window as unknown as {
    __strataPerf?: {
      enable: (on: boolean) => void;
      reset: () => void;
      getFrames: (n: number) => FrameDiagnostics[];
      getLast: () => FrameDiagnostics | null;
      isEnabled: () => boolean;
    };
  };
  if (globalThisAny.__strataPerf) {
    // StrictMode double-mounts effects in dev; the settings-driven
    // enableDrawDiagnostics(false) on the second pass would otherwise leave
    // the ring buffer dead. perf=1 always wins while the page is open.
    enableDrawDiagnostics(true);
    return;
  }
  enableDrawDiagnostics(true);
  globalThisAny.__strataPerf = {
    enable: enableDrawDiagnostics,
    reset: resetDiagnostics,
    getFrames: getRecentFrames,
    getLast: getLastFrame,
    isEnabled: isDiagnosticsEnabled,
  };
}

export function resetDiagnostics(): void {
  diagRing.length = 0;
}

export function recordFrame(frame: FrameDiagnostics): void {
  if (!diagEnabled) return;
  diagRing.push({ ...frame, committedAt: performance.now() });
  if (diagRing.length > MAX_DIAG_FRAMES) diagRing.shift();
}

export function getRecentFrames(n = 10): FrameDiagnostics[] {
  return diagRing.slice(-n);
}

export function getFrameCount(): number {
  return diagRing.length;
}

export function getLastFrame(): FrameDiagnostics | null {
  return diagRing.length > 0 ? diagRing[diagRing.length - 1]! : null;
}

/** Render the diagnostics overlay onto a 2D context. */
export function renderDrawDiagnostics(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  if (!diagEnabled || diagRing.length === 0) return;
  const last = diagRing[diagRing.length - 1]!;
  const recent = diagRing.slice(-30);
  const avgMs = recent.reduce((s, f) => s + f.totalMs, 0) / recent.length;
  const sorted = [...recent].sort((a, b) => a.totalMs - b.totalMs);
  const p95Ms = sorted[Math.floor(recent.length * 0.95)]?.totalMs ?? 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(canvasWidth - 420, 4, 416, 160);
  ctx.fillStyle = '#0f0';
  ctx.textAlign = 'right';
  const hashMs = last.hashMs ?? 0;
  // Everything inside the frame that isn't buildIr, replay, or the hash loop
  // (node walk, style/variant resolution, culling, dirty-region). Surfacing it
  // means an untimed cost can no longer regress the frame invisibly.
  const otherMs = Math.max(0, last.totalMs - last.buildIrMs - last.replayMs - hashMs);
  const lines = [
    `F#${last.frameIndex}  dv#${last.docVersion}  rc#${last.redrawCount}  tier:${last.profileTier}`,
    `path:${last.renderPath}  ${last.wasDirty ? 'dirty' : 'clean'}  ${last.partialRedraw ? 'partial' : 'full'}`,
    `nodes:${last.nodeCount}  culled:${last.culledCount}  cache:${last.cacheHitCount}`,
    `cache: ${last.cacheEntries} entries, ${(last.cacheBytes / 1024).toFixed(0)} KB`,
    `hash:${hashMs.toFixed(1)}ms  build:${last.buildIrMs.toFixed(1)}ms  replay:${last.replayMs.toFixed(1)}ms  other:${otherMs.toFixed(1)}ms`,
    `total:${last.totalMs.toFixed(1)}ms  avg30:${avgMs.toFixed(1)}ms  p95:${p95Ms.toFixed(1)}ms`,
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth - 8, 20 + i * 18);
  });
  ctx.restore();
}
