/**
 * Centralized frame invalidation coordinator for the canvas content surface.
 *
 * Every trigger that wants a canvas frame goes through `request()`; the
 * coordinator merges contributing invalidations within a scheduling window,
 * and `beginFrame()` decides — before any scene traversal — whether a frame
 * is actually needed:
 *
 *   - `skip`    nothing changed since the last completed frame; the backing
 *               store already shows the current state (suppressed clean frame)
 *   - `present` no scene work is needed, but a freshly arrived worker bitmap
 *               must be composited (previously this re-ran the entire
 *               visible-list pass with `redrawReason: 'clean'`)
 *   - `content` a real invalidation exists; draw the scene
 *
 * State diffs are computed against the last *completed* frame's snapshot, so
 * repeated no-op triggers cannot accumulate — a skip does not advance the
 * baseline. Reasons are structural (contributing invalidation list) rather
 * than a single label, so a frame that both panned and decoded an image
 * records both.
 *
 * All counters are plain integers; the coordinator allocates nothing on the
 * hot path beyond the bounded pending-invalidation list.
 */

export type RedrawReason =
  | 'scene-mutation'
  | 'transform-preview'
  | 'selection-overlay'
  | 'hover-overlay'
  | 'snap-overlay'
  | 'viewport-pan'
  | 'viewport-zoom'
  | 'canvas-resize'
  | 'asset-ready'
  | 'effect-update'
  | 'animation'
  | 'media-frame'
  | 'document-switch'
  | 'backing-store-recovery'
  | 'worker-present'
  | 'debug-overlay'
  | 'theme-change'
  | 'canvas-mode'
  | 'unknown';

export interface FrameInvalidation {
  reason: RedrawReason;
  /** Stable caller identity for attribution ("worker.reply", "context-restore"). */
  source: string;
  nodeIds?: readonly string[];
  dirtyRects?: readonly { x: number; y: number; w: number; h: number }[];
  /** Defaults to true — scene content changed. */
  contentChanged?: boolean;
  /** Defaults to false — transient overlay visuals only. */
  overlayChanged?: boolean;
  /** Defaults to false — the viewport (camera/size) changed. */
  viewportChanged?: boolean;
  requiresFullRedraw?: boolean;
  timestamp: number;
}

/** Render-state snapshot captured at frame time, compared against the last completed frame. */
export interface FrameStateSnapshot {
  doc: unknown;
  docId: string;
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  imageCacheStamp: number;
  fontLoadStamp: number;
  canvasW: number;
  canvasH: number;
  dpr: number;
  themeRevision: number;
  /** Monotonic stamp that changes while a timeline is playing. */
  motionStamp: number;
  /**
   * Monotonic stamp that advances only when some animated-media usage's
   * resolved source frame changed (a node on a long source frame does not
   * invalidate every RAF).
   */
  mediaStamp: number;
  canvasMode: string;
}

export type FrameBeginDecisionKind = 'skip' | 'present' | 'content';

export interface FrameBeginDecision {
  kind: FrameBeginDecisionKind;
  /** All contributing reasons (structural diffs + explicit invalidations). */
  reasons: readonly RedrawReason[];
  /** Explicit invalidations merged into this frame (bounded). */
  explicit: readonly FrameInvalidation[];
  /**
   * When a frame runs as `content` despite having no diff and no explicit
   * invalidation, this explains why suppression did not apply — e.g. a
   * `requiresFullRedraw` flag or a present that raced a content change.
   */
  unsuppressedCause: string | null;
  /** True when the merged invalidation demands a full (non-partial) redraw. */
  requiresFullRedraw: boolean;
}

export interface RedrawCoordinatorDiagnostics {
  requestedFrames: number;
  coalescedRequests: number;
  duplicateRequestsSuppressed: number;
  submittedFrames: number;
  skippedCleanFrames: number;
  overlayOnlyFrames: number;
  contentFrames: number;
  presentFrames: number;
  fullRedrawFrames: number;
  framesRescheduledDuringRender: number;
  staleWorkerResponses: number;
  lastDecision: FrameBeginDecision | null;
  pendingExplicitCount: number;
}

export interface RedrawCoordinator {
  request(invalidation: FrameInvalidation): void;
  beginFrame(snapshot: FrameStateSnapshot, hasPendingPresent: boolean): FrameBeginDecision;
  completeFrame(
    decision: FrameBeginDecision,
    snapshot: FrameStateSnapshot,
    outcome: {
      contentDrawn: boolean;
      fullRedraw: boolean;
    },
  ): void;
  noteRescheduledDuringRender(): void;
  noteStaleWorkerResponse(): void;
  getDiagnostics(): RedrawCoordinatorDiagnostics;
  reset(): void;
}

/**
 * One-call frame entry: build the snapshot, take the coordinator decision and
 * handle the suppressed-clean case. Returns null when the frame must not
 * render at all (no scene work, no present pending); the caller then skips
 * its draw pipeline. Returns the decision + snapshot for the render path
 * otherwise.
 */
export function beginContentFrame(args: {
  coordinator: RedrawCoordinator;
  getState: () => {
    document: { id: string } | null;
    zoom: number;
    pan: { x: number; y: number };
    cameraRotation?: number;
    themeRevision: number;
    motion: { isPlaying: boolean; currentTime: number };
    media: { presentedStamp: number };
    canvasMode: string;
  };
  imageCacheStamp: number;
  fontLoadStamp: number;
  cssW: number;
  cssH: number;
  dpr: number;
  hasPendingPresent: boolean;
}): {
  coordinator: RedrawCoordinator;
  snapshot: FrameStateSnapshot;
  decision: FrameBeginDecision;
} | null {
  const s = args.getState();
  const snapshot = createFrameSnapshot({
    doc: s.document,
    docId: s.document?.id ?? '',
    zoom: s.zoom,
    panX: s.pan.x,
    panY: s.pan.y,
    rotation: s.cameraRotation ?? 0,
    imageCacheStamp: args.imageCacheStamp,
    fontLoadStamp: args.fontLoadStamp,
    canvasW: args.cssW,
    canvasH: args.cssH,
    dpr: args.dpr,
    themeRevision: s.themeRevision,
    motionPlaying: s.motion.isPlaying,
    motionTime: s.motion.currentTime,
    mediaStamp: s.media.presentedStamp,
    canvasMode: s.canvasMode,
  });
  const decision = args.coordinator.beginFrame(snapshot, args.hasPendingPresent);
  if (decision.kind === 'skip') {
    args.coordinator.completeFrame(decision, snapshot, {
      contentDrawn: false,
      fullRedraw: false,
    });
    return null;
  }
  return { coordinator: args.coordinator, snapshot, decision };
}

export interface RedrawCoordinatorOptions {
  /** Maximum explicit invalidations merged into one frame decision. */
  maxExplicitPerFrame?: number;
  /** Maximum contributing reasons kept in a decision. */
  maxReasonsPerFrame?: number;
}

/**
 * Build a render-state snapshot from the editor state values drawContent has
 * in scope. Compared against the last completed frame's snapshot to derive
 * the contributing invalidation reasons.
 */
export function createFrameSnapshot(args: {
  doc: unknown;
  docId: string;
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  imageCacheStamp: number;
  fontLoadStamp: number;
  canvasW: number;
  canvasH: number;
  dpr: number;
  themeRevision: number;
  motionPlaying: boolean;
  motionTime: number;
  mediaStamp: number;
  canvasMode: string;
}): FrameStateSnapshot {
  return {
    doc: args.doc,
    docId: args.docId,
    zoom: args.zoom,
    panX: args.panX,
    panY: args.panY,
    rotation: args.rotation,
    imageCacheStamp: args.imageCacheStamp,
    fontLoadStamp: args.fontLoadStamp,
    canvasW: args.canvasW,
    canvasH: args.canvasH,
    dpr: args.dpr,
    themeRevision: args.themeRevision,
    motionStamp: args.motionPlaying ? args.motionTime : 0,
    mediaStamp: args.mediaStamp,
    canvasMode: args.canvasMode,
  };
}

const DEFAULT_MAX_EXPLICIT = 16;
const DEFAULT_MAX_REASONS = 8;

export function createRedrawCoordinator(options: RedrawCoordinatorOptions = {}): RedrawCoordinator {
  const maxExplicit = options.maxExplicitPerFrame ?? DEFAULT_MAX_EXPLICIT;
  const maxReasons = options.maxReasonsPerFrame ?? DEFAULT_MAX_REASONS;
  let lastCompleted: FrameStateSnapshot | null = null;
  let pendingExplicit: FrameInvalidation[] = [];
  let lastRequestKey = '';
  const counters = {
    requestedFrames: 0,
    coalescedRequests: 0,
    duplicateRequestsSuppressed: 0,
    submittedFrames: 0,
    skippedCleanFrames: 0,
    overlayOnlyFrames: 0,
    contentFrames: 0,
    presentFrames: 0,
    fullRedrawFrames: 0,
    framesRescheduledDuringRender: 0,
    staleWorkerResponses: 0,
  };
  let lastDecision: FrameBeginDecision | null = null;

  function diffReasons(snapshot: FrameStateSnapshot): RedrawReason[] {
    const reasons: RedrawReason[] = [];
    const previous = lastCompleted;
    if (!previous) {
      reasons.push('scene-mutation');
      return reasons;
    }
    if (previous.docId !== snapshot.docId) {
      reasons.push('document-switch');
    } else if (previous.doc !== snapshot.doc) {
      reasons.push('scene-mutation');
    }
    if (previous.zoom !== snapshot.zoom) {
      reasons.push('viewport-zoom');
    }
    if (previous.panX !== snapshot.panX || previous.panY !== snapshot.panY) {
      reasons.push('viewport-pan');
    }
    if (previous.rotation !== snapshot.rotation) {
      reasons.push('viewport-pan');
    }
    if (previous.imageCacheStamp !== snapshot.imageCacheStamp) {
      reasons.push('asset-ready');
    }
    if (previous.fontLoadStamp !== snapshot.fontLoadStamp) {
      reasons.push('asset-ready');
    }
    if (
      previous.canvasW !== snapshot.canvasW ||
      previous.canvasH !== snapshot.canvasH ||
      previous.dpr !== snapshot.dpr
    ) {
      reasons.push('canvas-resize');
    }
    if (previous.motionStamp !== snapshot.motionStamp) {
      reasons.push('animation');
    }
    if (previous.mediaStamp !== snapshot.mediaStamp) {
      reasons.push('media-frame');
    }
    if (previous.themeRevision !== snapshot.themeRevision) {
      reasons.push('theme-change');
    }
    if (previous.canvasMode !== snapshot.canvasMode) {
      reasons.push('canvas-mode');
    }
    return reasons;
  }

  function classify(reasons: readonly RedrawReason[], hasPresent: boolean): FrameBeginDecisionKind {
    if (reasons.length > 0) return 'content';
    // Presentation of an already-current worker bitmap is the one legitimate
    // frame that needs no invalidation.
    if (hasPresent) return 'present';
    return 'skip';
  }

  return {
    request(invalidation) {
      counters.requestedFrames++;
      // A request identical to the previous unflushed one is a duplicate from
      // the same trigger (e.g. React double-invocation) — suppress it.
      const key = `${invalidation.reason}:${invalidation.source}:${invalidation.timestamp}`;
      if (key === lastRequestKey) {
        counters.duplicateRequestsSuppressed++;
        return;
      }
      lastRequestKey = key;
      if (pendingExplicit.length >= maxExplicit) {
        counters.coalescedRequests++;
        return;
      }
      pendingExplicit.push({
        ...invalidation,
        contentChanged: invalidation.contentChanged ?? true,
        overlayChanged: invalidation.overlayChanged ?? false,
        viewportChanged: invalidation.viewportChanged ?? false,
        dirtyRects: undefined,
      });
      counters.coalescedRequests++;
    },

    beginFrame(snapshot, hasPendingPresent) {
      const diff = diffReasons(snapshot);
      const explicit = pendingExplicit;
      pendingExplicit = [];
      lastRequestKey = '';

      const reasons: RedrawReason[] = [...diff];
      for (const inv of explicit) {
        if (reasons.includes(inv.reason)) continue;
        if (reasons.length >= maxReasons) break;
        reasons.push(inv.reason);
      }

      const onlyOverlay =
        explicit.length > 0 &&
        explicit.every((inv) => !inv.contentChanged && !inv.viewportChanged && inv.overlayChanged);
      const hasSceneWork = reasons.some(
        (reason) =>
          reason !== 'selection-overlay' &&
          reason !== 'hover-overlay' &&
          reason !== 'snap-overlay' &&
          reason !== 'debug-overlay',
      );

      let kind: FrameBeginDecisionKind;
      let unsuppressedCause: string | null = null;
      if (explicit.some((inv) => inv.requiresFullRedraw)) {
        kind = 'content';
        unsuppressedCause = 'explicit-requires-full-redraw';
      } else if (!hasSceneWork && onlyOverlay) {
        kind = 'skip';
      } else {
        kind = classify(reasons, hasPendingPresent);
        if (kind === 'present' && !reasons.includes('worker-present')) {
          reasons.push('worker-present');
        }
        if (kind === 'content' && reasons.length === 0 && explicit.length === 0) {
          unsuppressedCause = 'unknown-origin';
        }
      }

      const decision: FrameBeginDecision = {
        kind,
        reasons,
        explicit,
        unsuppressedCause,
        requiresFullRedraw: explicit.some((inv) => inv.requiresFullRedraw === true),
      };
      lastDecision = decision;
      return decision;
    },

    completeFrame(decision, snapshot, outcome) {
      if (outcome.contentDrawn || decision.kind === 'present') {
        lastCompleted = { ...snapshot };
      }
      counters.submittedFrames++;
      if (decision.kind === 'skip') {
        counters.skippedCleanFrames++;
      } else if (decision.kind === 'present') {
        counters.presentFrames++;
      } else {
        counters.contentFrames++;
        if (outcome.fullRedraw) counters.fullRedrawFrames++;
      }
    },

    noteRescheduledDuringRender() {
      counters.framesRescheduledDuringRender++;
    },

    noteStaleWorkerResponse() {
      counters.staleWorkerResponses++;
    },

    getDiagnostics() {
      return {
        requestedFrames: counters.requestedFrames,
        coalescedRequests: counters.coalescedRequests,
        duplicateRequestsSuppressed: counters.duplicateRequestsSuppressed,
        submittedFrames: counters.submittedFrames,
        skippedCleanFrames: counters.skippedCleanFrames,
        overlayOnlyFrames: counters.overlayOnlyFrames,
        contentFrames: counters.contentFrames,
        presentFrames: counters.presentFrames,
        fullRedrawFrames: counters.fullRedrawFrames,
        framesRescheduledDuringRender: counters.framesRescheduledDuringRender,
        staleWorkerResponses: counters.staleWorkerResponses,
        lastDecision,
        pendingExplicitCount: pendingExplicit.length,
      };
    },

    reset() {
      lastCompleted = null;
      pendingExplicit = [];
      lastRequestKey = '';
      for (const key of Object.keys(counters) as (keyof typeof counters)[]) {
        counters[key] = 0;
      }
      lastDecision = null;
    },
  };
}
