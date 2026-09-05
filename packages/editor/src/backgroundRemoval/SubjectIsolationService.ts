/**
 * Centralized subject isolation lifecycle: source decode, request tracking,
 * staleness detection, inference orchestration, and commit preparation.
 *
 * Research basis: Figma's non-destructive raster mask model, Photoshop's
 * subject-selection pipeline with stateful invalidation guards.
 */

import type { Document } from '@varve/scene';
import { resolveNodePaints } from '@varve/scene';
import type { BackgroundRemovalSourceIdentity, EditorState } from '../context/types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubjectIsolationRequest {
  requestId: string;
  documentId: string;
  nodeId: string;
  sourceFingerprint: string;
  sourceIdentity?: BackgroundRemovalSourceIdentity;
  sourceLocator: string;
  placementRevision: string | number;
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
 * source image data. Without SubtleCrypto, use a unique non-coalescing token;
 * never mistake equal dimensions or locator lengths for equal content.
 */
let unverifiedFingerprintGeneration = 0;

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
    return `${src.length}:${imageData?.width ?? 0}x${imageData?.height ?? 0}:${hex}`;
  } catch {
    return `fp:unverified:${++unverifiedFingerprintGeneration}`;
  }
}

/**
 * Extract the placement-relevant fields from an image fill to detect changes
 * in crop/placement that should invalidate a previous isolation result.
 */
export function computePlacementRevision(
  imageFill: {
    x?: number;
    y?: number;
    scale?: number;
    fit?: string;
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
    crop?: { x: number; y: number; w: number; h: number };
  } | null,
): string | number {
  if (!imageFill) return 0;
  const { crop } = imageFill;
  return JSON.stringify([
    imageFill.x ?? 0,
    imageFill.y ?? 0,
    imageFill.scale ?? 1,
    imageFill.fit ?? '',
    imageFill.rotation ?? 0,
    imageFill.flipH ?? false,
    imageFill.flipV ?? false,
    crop ? [crop.x, crop.y, crop.w, crop.h] : null,
  ]);
}

/** A node-wide mask must not silently choose one of several image fills. */
export function resolveIsolationSource(doc: Document, nodeId: string) {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape') return null;
  const fills = resolveNodePaints({ fills: node.fills, paintRefs: node.paintRefs }, doc);
  const images = fills.filter((fill) => fill.type === 'image' && fill.image);
  if (images.length !== 1) return null;
  const image = images[0]!.image!;
  const asset = image.assetId ? doc.assets?.[image.assetId] : undefined;
  return { node, image, asset, mask: node.mask };
}

export function matchesIsolationSource(
  doc: Document,
  nodeId: string,
  identity: BackgroundRemovalSourceIdentity,
): boolean {
  const source = resolveIsolationSource(doc, nodeId);
  return Boolean(
    source &&
      source.image === identity.image &&
      source.asset === identity.asset &&
      source.mask === identity.mask,
  );
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
      this.enginePromise = import('@varve/engine').then((m) => ({
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
      this.currentRequest.sourceLocator === request.sourceLocator &&
      this.currentRequest.sourceIdentity?.image === request.sourceIdentity?.image &&
      this.currentRequest.sourceIdentity?.asset === request.sourceIdentity?.asset &&
      this.currentRequest.sourceIdentity?.mask === request.sourceIdentity?.mask &&
      this.currentRequest.placementRevision === request.placementRevision &&
      this.currentRequest.documentId === request.documentId &&
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
    const source = resolveIsolationSource(currentState.document, request.nodeId);
    if (!source || source.image.src !== request.sourceLocator) {
      return { stale: true, reason: 'source-replaced' };
    }
    if (
      request.sourceIdentity &&
      (request.sourceIdentity.image !== source.image ||
        request.sourceIdentity.asset !== source.asset ||
        request.sourceIdentity.mask !== source.mask)
    ) {
      return { stale: true, reason: 'source-pixels-changed' };
    }
    if (computePlacementRevision(source.image) !== request.placementRevision) {
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
      if (signal.aborted) return;
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

      if (this.currentAbortController?.signal === signal && !signal.aborted) {
        this.currentResolve?.(isolationResult);
      }
    } catch (e) {
      if (signal.aborted) return;
      if (this.currentAbortController?.signal === signal) {
        this.currentReject?.(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      if (this.currentAbortController?.signal === signal) {
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
