import { describe, expect, it } from 'vitest';
import {
  createRedrawCoordinator,
  type FrameInvalidation,
  type FrameStateSnapshot,
} from '../redrawCoordinator';

const DOC = { id: 'doc' };

function snapshot(overrides: Partial<FrameStateSnapshot> = {}): FrameStateSnapshot {
  return {
    doc: DOC,
    docId: 'doc',
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    imageCacheStamp: 0,
    fontLoadStamp: 0,
    canvasW: 1600,
    canvasH: 1000,
    dpr: 1,
    themeRevision: 0,
    motionStamp: 0,
    mediaStamp: 0,
    canvasMode: 'full',
    showOriginalBgNodeId: null,
    ...overrides,
  };
}

function invalidation(overrides: Partial<FrameInvalidation> = {}): FrameInvalidation {
  return {
    reason: 'worker-present',
    source: 'test',
    contentChanged: true,
    overlayChanged: false,
    viewportChanged: false,
    timestamp: 1,
    ...overrides,
  };
}

describe('redraw coordinator', () => {
  it('skips a frame when nothing changed since the last completed frame', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    expect(first.kind).toBe('content');
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    const second = coordinator.beginFrame(snapshot(), false);
    expect(second.kind).toBe('skip');
    coordinator.completeFrame(second, snapshot(), { contentDrawn: false, fullRedraw: false });

    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.submittedFrames).toBe(2);
    expect(diagnostics.contentFrames).toBe(1);
    expect(diagnostics.skippedCleanFrames).toBe(1);
  });

  it('does not advance the baseline on a skipped frame, so no-op triggers keep skipping', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    // A camera move and a no-op trigger: the camera move renders; the no-op
    // must still skip because the last *completed* frame is current.
    const moved = snapshot({ panX: 40 });
    const second = coordinator.beginFrame(moved, false);
    expect(second.kind).toBe('content');
    coordinator.completeFrame(second, moved, { contentDrawn: true, fullRedraw: false });

    const third = coordinator.beginFrame(moved, false);
    expect(third.kind).toBe('skip');
    coordinator.completeFrame(third, moved, { contentDrawn: false, fullRedraw: false });
    expect(coordinator.getDiagnostics().skippedCleanFrames).toBe(1);
  });

  it('distinguishes zoom from pan and preserves every contributing reason', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    const moved = snapshot({ zoom: 2, panX: 100, imageCacheStamp: 3, fontLoadStamp: 4 });
    const decision = coordinator.beginFrame(moved, false);
    expect(decision.kind).toBe('content');
    expect(decision.reasons).toContain('viewport-zoom');
    expect(decision.reasons).toContain('viewport-pan');
    expect(decision.reasons).toContain('asset-ready');
  });

  it('classifies canvas resize, animation, theme, mode and document switch', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    const resize = coordinator.beginFrame(snapshot({ canvasW: 1200 }), false);
    expect(resize.reasons).toContain('canvas-resize');

    const anim = coordinator.beginFrame(snapshot({ motionStamp: 7 }), false);
    expect(anim.reasons).toContain('animation');

    const theme = coordinator.beginFrame(snapshot({ themeRevision: 1 }), false);
    expect(theme.reasons).toContain('theme-change');

    const mode = coordinator.beginFrame(snapshot({ canvasMode: 'outline' }), false);
    expect(mode.reasons).toContain('canvas-mode');

    const switched = coordinator.beginFrame(
      snapshot({ doc: { id: 'other' }, docId: 'other' }),
      false,
    );
    expect(switched.reasons).toContain('document-switch');
  });

  it('runs a present-only frame for a pending worker bitmap without scene reasons', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    const present = coordinator.beginFrame(snapshot(), true);
    expect(present.kind).toBe('present');
    expect(present.reasons).toContain('worker-present');
    coordinator.completeFrame(present, snapshot(), { contentDrawn: false, fullRedraw: false });

    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.presentFrames).toBe(1);
    expect(diagnostics.skippedCleanFrames).toBe(0);
  });

  it('prefers content over present when both apply', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    const decision = coordinator.beginFrame(snapshot({ panX: 9 }), true);
    expect(decision.kind).toBe('content');
  });

  it('suppresses duplicate requests from the same trigger', () => {
    const coordinator = createRedrawCoordinator();
    coordinator.request(invalidation({ timestamp: 10 }));
    coordinator.request(invalidation({ timestamp: 10 }));
    expect(coordinator.getDiagnostics().duplicateRequestsSuppressed).toBe(1);
  });

  it('coalesces distinct requests into one frame and preserves them', () => {
    const coordinator = createRedrawCoordinator();
    coordinator.request(invalidation({ reason: 'asset-ready', source: 'image.decode' }));
    coordinator.request(invalidation({ reason: 'backing-store-recovery', source: 'ctx.restore' }));
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    expect(first.explicit.map((inv) => inv.reason)).toEqual([
      'asset-ready',
      'backing-store-recovery',
    ]);
    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.requestedFrames).toBe(2);
    expect(diagnostics.contentFrames).toBe(1);
  });

  it('treats overlay-only requests as skippable without content work', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    coordinator.request(
      invalidation({
        reason: 'hover-overlay',
        contentChanged: false,
        overlayChanged: true,
        viewportChanged: false,
      }),
    );
    const decision = coordinator.beginFrame(snapshot(), false);
    expect(decision.kind).toBe('skip');
    coordinator.completeFrame(decision, snapshot(), { contentDrawn: false, fullRedraw: false });
    expect(coordinator.getDiagnostics().skippedCleanFrames).toBe(1);
  });

  it('honours an explicit requiresFullRedraw and explains it', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: false });

    coordinator.request(invalidation({ reason: 'scene-mutation', requiresFullRedraw: true }));
    const decision = coordinator.beginFrame(snapshot(), false);
    expect(decision.kind).toBe('content');
    expect(decision.requiresFullRedraw).toBe(true);
    expect(decision.unsuppressedCause).toBe('explicit-requires-full-redraw');
  });

  it('records full-redraw outcomes only for content frames', () => {
    const coordinator = createRedrawCoordinator();
    const first = coordinator.beginFrame(snapshot(), false);
    coordinator.completeFrame(first, snapshot(), { contentDrawn: true, fullRedraw: true });
    const second = coordinator.beginFrame(snapshot(), true);
    coordinator.completeFrame(second, snapshot(), { contentDrawn: false, fullRedraw: false });

    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.fullRedrawFrames).toBe(1);
    expect(diagnostics.presentFrames).toBe(1);
  });

  it('counts reschedules and stale worker responses', () => {
    const coordinator = createRedrawCoordinator();
    coordinator.noteRescheduledDuringRender();
    coordinator.noteRescheduledDuringRender();
    coordinator.noteStaleWorkerResponse();
    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.framesRescheduledDuringRender).toBe(2);
    expect(diagnostics.staleWorkerResponses).toBe(1);
  });

  it('resets cleanly', () => {
    const coordinator = createRedrawCoordinator();
    coordinator.request(invalidation());
    coordinator.noteStaleWorkerResponse();
    coordinator.reset();
    const diagnostics = coordinator.getDiagnostics();
    expect(diagnostics.requestedFrames).toBe(0);
    expect(diagnostics.staleWorkerResponses).toBe(0);
    expect(diagnostics.pendingExplicitCount).toBe(0);
    // After reset the baseline is gone, so the next frame renders.
    const decision = coordinator.beginFrame(snapshot(), false);
    expect(decision.kind).toBe('content');
  });

  it('never classifies a first frame as skip', () => {
    const coordinator = createRedrawCoordinator();
    const decision = coordinator.beginFrame(snapshot(), false);
    expect(decision.kind).toBe('content');
  });
});
