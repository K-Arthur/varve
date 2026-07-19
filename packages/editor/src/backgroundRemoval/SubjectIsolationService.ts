/**
 * Centralized subject isolation lifecycle: source decode, request tracking,
 * staleness detection, inference orchestration, and commit preparation.
 *
 * Research basis: Figma's non-destructive raster mask model, Photoshop's
 * subject-selection pipeline with stateful invalidation guards.
 */

import type { EditorState } from '../context/types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubjectIsolationRequest {
  requestId: string;
  documentId: string;
  documentRevision: number;
  nodeId: string;
  sourceFingerprint: string;
  sourceLocator: string;
  sourcePixelRevision: number;
  placementRevision: number;
  sourceWidth: number;
  sourceHeight: number;
  imageData: ImageData;
  options: {
    method: 'quick' | 'ai-balanced' | 'ai-quality';
    feather: number;
    decontaminate: boolean;
  };
}

export interface SubjectIsolationResult {
  request: SubjectIsolationRequest;
  maskDataUrl: string;
  maskWidth: number;
  maskHeight: number;
  provenance: {
    method: string;
    requestedMethod: string;
    runtime: string;
    executionProvider?: 'webgpu' | 'webgl' | 'wasm' | 'native';
    modelId?: string;
    generatedAt: number;
  };
  confidence: number;
}

export type StaleReason =
  | 'document-switched'
  | 'document-revision-changed'
  | 'node-deleted'
  | 'source-replaced'
  | 'source-pixels-changed'
  | 'placement-changed'
  | 'not-selected';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute a content-addressed source fingerprint (SHA-256 hex prefix) from
 * source image data. Falls back to a length-based marker when SubtleCrypto
 * is unavailable (e.g. some non-secure-context test environments).
 */
export async function computeSourceFingerprint(
  src: string,
  imageData?: ImageData,
): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = imageData?.data ?? encoder.encode(src);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${src.length}:${imageData?.width ?? 0}x${imageData?.height ?? 0}:${hex.slice(0, 16)}`;
  } catch {
    return `fp:${src.length}:${imageData?.width ?? 0}:${imageData?.height ?? 0}`;
  }
}

/**
 * Extract the placement-relevant fields from an image fill to detect changes
 * in crop/placement that should invalidate a previous isolation result.
 */
export function computePlacementRevision(
  imageFill: { x?: number; y?: number; scale?: number; fit?: string } | null,
): number {
  if (!imageFill) return 0;
  let hash = 5381;
  hash = ((hash << 5) + hash + Math.round((imageFill.x ?? 0) * 100)) | 0;
  hash = ((hash << 5) + hash + Math.round((imageFill.y ?? 0) * 100)) | 0;
  hash = ((hash << 5) + hash + Math.round((imageFill.scale ?? 1) * 1000)) | 0;
  hash = ((hash << 5) + hash + (imageFill.fit ?? '').length) | 0;
  return Math.abs(hash);
}

// ── Service ────────────────────────────────────────────────────────────────

export interface SubjectIsolationEngine {
  removeBackground(
    imageData: ImageData,
    options: { method: string; feather: number; decontaminate: boolean },
    signal?: AbortSignal,
  ): Promise<{
    maskDataUrl: string;
    confidence: number;
    method: string;
    processingTimeMs: number;
    width: number;
    height: number;
    executionProvider?: 'webgpu' | 'webgl' | 'wasm' | 'native';
    modelId?: string;
  }>;
}

export class SubjectIsolationService {
  private engine: SubjectIsolationEngine | null = null;
  private enginePromise: Promise<SubjectIsolationEngine> | null = null;
  private currentRequest: SubjectIsolationRequest | null = null;
  private currentAbortController: AbortController | null = null;
  private currentPromise: Promise<SubjectIsolationResult> | null = null;
  private currentResolve: ((result: SubjectIsolationResult) => void) | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  private externalSignal: AbortSignal | null = null;
  private externalAbortHandler: (() => void) | null = null;

  constructor(engine?: SubjectIsolationEngine) {
    if (engine) {
      this.engine = engine;
    }
  }

  private async getEngine(): Promise<SubjectIsolationEngine> {
    if (this.engine) return this.engine;
    if (!this.enginePromise) {
      this.enginePromise = import('@strata/engine').then((m) => ({
        removeBackground: m.removeBackground as SubjectIsolationEngine['removeBackground'],
      }));
    }
    return this.enginePromise;
  }

  /**
   * Start a subject isolation request.
   *
   * If the exact same request (same request-id-level fields) is already in
   * flight, returns the existing promise (coalesce). If a different request is
   * in flight, cancels it and starts the new one.
   *
   * NOTE: This method is intentionally NOT async so that the synchronous
   * coalesce check can return the exact same Promise reference (not an
   * async-wrapper copy).
   */
  isolate(
    request: SubjectIsolationRequest,
    externalSignal?: AbortSignal,
  ): Promise<SubjectIsolationResult> {
    if (externalSignal?.aborted) return Promise.reject(new Error('cancelled'));
    if (
      this.currentRequest &&
      this.currentRequest.nodeId === request.nodeId &&
      this.currentRequest.sourceFingerprint === request.sourceFingerprint &&
      this.currentRequest.sourcePixelRevision === request.sourcePixelRevision &&
      this.currentRequest.placementRevision === request.placementRevision &&
      this.currentRequest.documentId === request.documentId &&
      this.currentRequest.documentRevision === request.documentRevision &&
      this.currentRequest.options.method === request.options.method &&
      this.currentRequest.options.feather === request.options.feather &&
      this.currentRequest.options.decontaminate === request.options.decontaminate
    ) {
      return this.currentPromise!;
    }

    this.cancel();
    this.currentRequest = request;

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    if (externalSignal) {
      this.externalSignal = externalSignal;
      this.externalAbortHandler = () => this.cancel();
      externalSignal.addEventListener('abort', this.externalAbortHandler, { once: true });
    }

    const promise = new Promise<SubjectIsolationResult>((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
    });
    this.currentPromise = promise;

    void this.executeInference(request, abortController.signal);

    return promise;
  }

  get isBusy(): boolean {
    return this.currentRequest !== null;
  }

  get pendingRequest(): SubjectIsolationRequest | null {
    return this.currentRequest;
  }

  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.currentReject) {
      this.currentReject(new Error('cancelled'));
    }
    this.clear();
  }

  dispose(): void {
    this.cancel();
  }

  /**
   * Check whether an isolation result is still valid against the current
   * editor state. Compares every capture-time field to detect staleness.
   */
  isStale(
    request: SubjectIsolationRequest,
    currentState: EditorState,
  ): { stale: boolean; reason?: StaleReason } {
    if (currentState.document.id !== request.documentId) {
      return { stale: true, reason: 'document-switched' };
    }
    const node = currentState.document.nodes[request.nodeId];
    if (!node) {
      return { stale: true, reason: 'node-deleted' };
    }
    if (node.kind !== 'shape') {
      return { stale: true, reason: 'node-deleted' };
    }
    if (!currentState.selection.includes(request.nodeId)) {
      return { stale: true, reason: 'not-selected' };
    }
    const imageFill = node.fills?.find((fill) => fill.type === 'image' && fill.image)?.image;
    if (!imageFill || imageFill.src !== request.sourceLocator) {
      return { stale: true, reason: 'source-replaced' };
    }
    if (computePlacementRevision(imageFill) !== request.placementRevision) {
      return { stale: true, reason: 'placement-changed' };
    }
    return { stale: false };
  }

  /**
   * Run the inference and notify the promise.
   */
  private async executeInference(
    request: SubjectIsolationRequest,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const engine = await this.getEngine();
      const result = await engine.removeBackground(
        request.imageData,
        {
          method: request.options.method,
          feather: request.options.feather,
          decontaminate: request.options.decontaminate,
        },
        signal,
      );

      if (signal.aborted) return;

      const isolationResult: SubjectIsolationResult = {
        request,
        maskDataUrl: result.maskDataUrl,
        maskWidth: result.width,
        maskHeight: result.height,
        provenance: {
          method: result.method,
          requestedMethod: request.options.method,
          runtime: `${result.processingTimeMs}ms`,
          executionProvider: result.executionProvider,
          modelId: result.modelId,
          generatedAt: Date.now(),
        },
        confidence: result.confidence,
      };

      if (this.currentRequest?.requestId === request.requestId && !signal.aborted) {
        this.currentResolve?.(isolationResult);
      }
    } catch (e) {
      if (signal.aborted) return;
      if (this.currentRequest?.requestId === request.requestId) {
        this.currentReject?.(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      if (this.currentRequest?.requestId === request.requestId) {
        this.clear();
      }
    }
  }

  private clear(): void {
    if (this.externalSignal && this.externalAbortHandler) {
      this.externalSignal.removeEventListener('abort', this.externalAbortHandler);
    }
    this.externalSignal = null;
    this.externalAbortHandler = null;
    this.currentRequest = null;
    this.currentPromise = null;
    this.currentResolve = null;
    this.currentReject = null;
    this.currentAbortController = null;
  }
}
