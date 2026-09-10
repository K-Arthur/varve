/**
 * Vectorization preview session — correlation, cancellation, and cleanup.
 *
 * A session owns one source node at a time. Every preview request gets a
 * monotonic sequence number; responses that are not the latest request are
 * discarded without touching the document. Abort controllers are tracked so
 * a newer request (or Cancel, selection change, or panel unmount) interrupts
 * in-flight work, and ImageData buffers are dropped by reference once the
 * request is superseded.
 *
 * The session never mutates the document — Apply goes through the editor's
 * insertTraceGroup + updateDoc path (single undo entry).
 */

export interface PreviewRequestHandle {
  /** Monotonic request id within the session. */
  requestId: number;
}

export class VectorizationSession {
  private lastRequestId = 0;
  private activeController: AbortController | null = null;
  private disposed = false;

  /** Whether this session is still usable (false after dispose). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Begin a new preview request, cancelling any in-flight one. */
  beginRequest(): { handle: PreviewRequestHandle; signal: AbortSignal } {
    this.activeController?.abort();
    this.lastRequestId += 1;
    const controller = new AbortController();
    this.activeController = controller;
    return { handle: { requestId: this.lastRequestId }, signal: controller.signal };
  }

  /** True when the response belongs to the newest request of this session. */
  isCurrent(handle: PreviewRequestHandle): boolean {
    return (
      !this.disposed &&
      handle.requestId === this.lastRequestId &&
      !this.activeController?.signal.aborted
    );
  }

  /** Cancel in-flight work and invalidate the session for further previews. */
  cancelAll(): void {
    this.activeController?.abort();
    this.lastRequestId += 1;
  }

  /** Release the active controller; called when a response is consumed. */
  release(handle: PreviewRequestHandle): void {
    if (handle.requestId === this.lastRequestId) this.activeController = null;
  }

  /** Dispose the session (unmount / source change / document close). */
  dispose(): void {
    this.cancelAll();
    this.disposed = true;
  }
}

export interface TraceDiagnostics {
  pathCount: number;
  pointCount: number;
  holeCount: number;
  omittedHoles: number;
  /** Estimated complexity (points * paths, informational). */
  complexity: number;
}

/** Collect diagnostics from a trace result. */
export function traceDiagnostics(result: {
  paths: Array<{ points: unknown[]; holes?: unknown[] }>;
  omittedHoles: number;
}): TraceDiagnostics {
  let pointCount = 0;
  let holeCount = 0;
  for (const path of result.paths) {
    pointCount += path.points.length;
    holeCount += (path.holes ?? []).length;
  }
  return {
    pathCount: result.paths.length,
    pointCount,
    holeCount,
    omittedHoles: result.omittedHoles,
    complexity: result.paths.length * pointCount,
  };
}
