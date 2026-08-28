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
  /** Work class used for this frame's dynamic display-interval budget. */
  frameWorkClass?: 'interaction' | 'authoritative' | 'background';
  /** Budget assigned to `frameWorkClass`, in milliseconds. */
  frameWorkBudgetMs?: number;
  totalMs: number;
  renderPath: 'structural' | 'worker' | 'worker-cached' | 'compositor';
  wasDirty: boolean;
  partialRedraw: boolean;
  cacheBytes: number;
  cacheEntries: number;
  profileTier: string;
  /**
   * Stable reason this frame was redrawn (see RedrawReason in dirtyRegion.ts).
   * Optional so pre-existing frame records stay valid.
   */
  redrawReason?: string;
  /**
   * All contributing invalidation reasons for this frame, in merge order
   * (structural diffs first, then explicit invalidations). A frame that both
   * panned and decoded an image records both, unlike `redrawReason`.
   */
  invalidationReasons?: string[];
  /**
   * Explicit trigger identity for imperative frames (worker reply, context
   * restore, engine init); undefined for reactive frames.
   */
  frameSource?: string;
  /**
   * When a content frame ran with no attributable invalidation, why suppression
   * did not apply (diagnostics — see redrawCoordinator.ts).
   */
  unsuppressedCause?: string;
  /** Fraction of the viewport covered by the dirty region (0 none, 1 full). */
  dirtyAreaRatio?: number;
  /**
   * Number of rectangles unioned into the dirty region before merging. For a
   * partial frame this is the count of contributed old/new bounds.
   */
  dirtyRects?: number;
  /** Rectangles retained after merging (bounded set). */
  dirtyRectsAfter?: number;
  /**
   * Bounding-box union of the merged set / sum of pre-merge areas. 1 means no
   * amplification; a large value means the single-union clip would clear
   * mostly empty space (the reason the merge keeps separate rects).
   */
  dirtyAmplification?: number;
  /** Why the merged set fell back to one viewport-sized rect, if it did. */
  dirtyMergeFallback?: string;
  /** Why a dirty frame fell back to a full redraw (null when partial is fine). */
  fullRedrawReason?: string;
  /**
   * Merged partial-redraw rectangle in canvas backing-store pixels. Keeping
   * this in screen space lets the diagnostics overlay draw it without scene
   * traversal or camera math.
   */
  dirtyScreenRect?: { x: number; y: number; w: number; h: number };
  /**
   * Monotonic render revision at frame commit time. When present, the
   * interaction trace can detect stale-frame presentation (a response whose
   * revision is behind the latest requested).
   */
  renderRevision?: number;
  /**
   * The coordinator's frame decision kind at commit time: 'skip', 'present',
   * or 'content'. When present, the interaction trace can distinguish
   * scene-free worker-bitmap composites from full scene replays.
   */
  frameDecision?: string;
}

export function resolveDirtyScreenRect(
  partialRedraw: boolean,
  dirtyRect: { x: number; y: number; w: number; h: number } | null,
  dpr: number,
): FrameDiagnostics['dirtyScreenRect'] {
  if (!partialRedraw || !dirtyRect) return undefined;
  return {
    x: dirtyRect.x * dpr,
    y: dirtyRect.y * dpr,
    w: dirtyRect.w * dpr,
    h: dirtyRect.h * dpr,
  };
}

const MAX_DIAG_FRAMES = 120;
const diagRing: FrameDiagnostics[] = [];
let diagEnabled = false;
let diagFrozen = false;
let overlayPruneScreenRects: readonly { x: number; y: number; w: number; h: number }[] | null =
  null;

export function enableDrawDiagnostics(force?: boolean): void {
  diagEnabled = force === true;
  if (!diagEnabled) diagFrozen = false;
}

export function isDiagnosticsEnabled(): boolean {
  return diagEnabled;
}

export function setDiagnosticsFrozen(frozen: boolean): void {
  diagFrozen = frozen;
}

export function isDiagnosticsFrozen(): boolean {
  return diagFrozen;
}

/**
 * Install a benchmark-only window handle so E2E/perf harnesses can read the
 * frame diagnostics ring buffer without console flooding. Gated to explicit
 * `?perf=1` opt-in (which also enables the ring buffer) so normal usage never
 * pays for it and the handle is inert (never installed) otherwise. Exposed as
 * `window.__varvePerf`.
 */
export function installPerfDiagnosticsHandle(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.search.includes('perf=1')) return;
  const globalThisAny = window as unknown as {
    __varvePerf?: {
      enable: (on: boolean) => void;
      reset: () => void;
      getFrames: (n: number) => FrameDiagnostics[];
      getLast: () => FrameDiagnostics | null;
      isEnabled: () => boolean;
      freeze: (frozen: boolean) => void;
      isFrozen: () => boolean;
    };
  };
  if (globalThisAny.__varvePerf) {
    // StrictMode double-mounts effects in dev; the settings-driven
    // enableDrawDiagnostics(false) on the second pass would otherwise leave
    // the ring buffer dead. perf=1 always wins while the page is open.
    enableDrawDiagnostics(true);
    return;
  }
  enableDrawDiagnostics(true);
  globalThisAny.__varvePerf = {
    enable: enableDrawDiagnostics,
    reset: resetDiagnostics,
    getFrames: getRecentFrames,
    getLast: getLastFrame,
    isEnabled: isDiagnosticsEnabled,
    freeze: setDiagnosticsFrozen,
    isFrozen: isDiagnosticsFrozen,
  };
}

export function resetDiagnostics(): void {
  diagRing.length = 0;
  overlayPruneScreenRects = null;
}

/**
 * Viewport-space merged dirty rects for the overlay. Stored here (not in the
 * perf runtime) so the HUD renderer needs no extra import.
 */
export function recordPruneScreenRects(
  rects: readonly { x: number; y: number; w: number; h: number }[] | null,
): void {
  if (diagEnabled) overlayPruneScreenRects = rects;
}

export function getPruneScreenRectsForOverlay():
  | readonly {
      x: number;
      y: number;
      w: number;
      h: number;
    }[]
  | null {
  return overlayPruneScreenRects;
}

export function recordFrame(frame: FrameDiagnostics): void {
  if (!diagEnabled || diagFrozen) return;
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
  const dirtyArea =
    last.dirtyAreaRatio === undefined ? '?' : `${Math.round(last.dirtyAreaRatio * 100)}%`;
  const reason = last.redrawReason ?? '?';
  const fullReason = last.fullRedrawReason ? ` full:${last.fullRedrawReason}` : '';
  const invalidationReasons = last.invalidationReasons?.length
    ? ` invalidation:${last.invalidationReasons.join('+')}`
    : '';
  const source = last.frameSource ? ` source:${last.frameSource}` : '';
  const lines = [
    `F#${last.frameIndex}  dv#${last.docVersion}  rc#${last.redrawCount}  tier:${last.profileTier}`,
    `path:${last.renderPath}  ${last.wasDirty ? 'dirty' : 'clean'}  ${last.partialRedraw ? 'partial' : 'full'}`,
    `reason:${reason}  dirty:${dirtyArea}${fullReason}`,
    `${invalidationReasons || ''}${source}`.trim(),
    `nodes:${last.nodeCount}  culled:${last.culledCount}  cache:${last.cacheHitCount}`,
    `cache: ${last.cacheEntries} entries, ${(last.cacheBytes / 1024).toFixed(0)} KB`,
    `hash:${hashMs.toFixed(1)}ms  build:${last.buildIrMs.toFixed(1)}ms  replay:${last.replayMs.toFixed(1)}ms  other:${otherMs.toFixed(1)}ms`,
    `total:${last.totalMs.toFixed(1)}ms  avg30:${avgMs.toFixed(1)}ms  p95:${p95Ms.toFixed(1)}ms`,
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth - 8, 20 + i * 18);
  });
  if (last.partialRedraw && last.dirtyScreenRect) {
    const dirty = last.dirtyScreenRect;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.strokeRect(dirty.x, dirty.y, dirty.w, dirty.h);
  }
  // Individual merged dirty rects (the pruned paint regions) — drawn when the
  // frame was pruned, so the empty gaps between them are visible.
  if (last.partialRedraw && last.dirtyRectsAfter && last.dirtyRectsAfter > 0) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 1;
    const screen = getPruneScreenRectsForOverlay();
    if (screen && screen.length > 0) {
      for (const rect of screen) {
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }
  }
  ctx.restore();
}
