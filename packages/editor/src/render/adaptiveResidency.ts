/**
 * Adaptive render residency policy primitives.
 *
 * This module owns policy decisions, not document data. Render resources are
 * derived and disposable; export/print callers deliberately request a full
 * representation and never consult the interactive cap.
 */

export type RenderIntent = 'interactive' | 'settled-preview' | 'thumbnail' | 'export' | 'print';

export type VisibilityState =
  | 'hidden'
  | 'culled'
  | 'potentially-visible'
  | 'visible'
  | 'critical-visible';
export type ResidencyState =
  | 'evicted'
  | 'metadata-only'
  | 'decoded-proxy'
  | 'decoded-full'
  | 'gpu-proxy'
  | 'gpu-full'
  | 'pinned';
export type FidelityLevel =
  | 'placeholder'
  | 'thumbnail'
  | 'interactive-low'
  | 'interactive-medium'
  | 'interactive-high'
  | 'full'
  | 'export'
  | 'print';

export type RenderRepresentation =
  | 'full'
  | 'cached'
  | 'proxy'
  | 'simplified'
  | 'outline'
  | 'suspended';

export type ResourcePriority =
  | 'background'
  | 'speculative'
  | 'near-viewport'
  | 'selected'
  | 'visible'
  | 'critical';
export type PolicyReason =
  | 'hidden'
  | 'offscreen'
  | 'camera-moving'
  | 'projected-size'
  | 'memory-pressure'
  | 'budget'
  | 'pinned'
  | 'intent';

export interface RenderResourcePolicy {
  visibility: VisibilityState;
  residency: ResidencyState;
  fidelity: FidelityLevel;
  representation: RenderRepresentation;
  priority: ResourcePriority;
  reason: PolicyReason;
}

export interface RasterRepresentationRequest {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  zoom: number;
  /**
   * Long edge of this particular raster after the current camera/world
   * transform, in device pixels. When provided, it supersedes the viewport
   * heuristic: a tiny image must not decode as if it filled the whole canvas.
   */
  projectedLongEdge?: number;
  /** Authoritative source dimensions, used to keep proxy memory bounded. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Maximum decoded RGBA bytes permitted for this representation. */
  maxDecodedBytes?: number;
  /** True while a camera gesture is actively producing frames. */
  cameraMoving?: boolean;
  intent?: RenderIntent;
}

export interface RasterRepresentationDecision {
  maxSourceDim: number;
  requiredSourceDim: number;
  bucket: number;
  reason: PolicyReason;
}

const MIN_INTERACTIVE_BUCKET = 512;
const MAX_INTERACTIVE_BUCKET = 8192;
const MAX_SETTLED_BUCKET = 16384;
const INTERACTIVE_MARGIN = 1.25;
const SETTLED_MARGIN = 1.5;

function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(value));
}

function previousPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  return 2 ** Math.floor(Math.log2(value));
}

/**
 * Long-edge limit that keeps a proportional RGBA decode within a byte budget.
 * A missing/invalid source size deliberately returns infinity: the caller can
 * still select a useful proxy but cannot make a false memory guarantee.
 */
function maxLongEdgeForDecodedBudget(request: RasterRepresentationRequest): number {
  const width = request.sourceWidth;
  const height = request.sourceHeight;
  const byteBudget = request.maxDecodedBytes;
  if (
    !width ||
    !height ||
    !byteBudget ||
    width <= 0 ||
    height <= 0 ||
    byteBudget <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(byteBudget)
  ) {
    return Infinity;
  }
  const longEdge = Math.max(width, height);
  const aspect = Math.min(width, height) / longEdge;
  return Math.max(1, Math.sqrt(byteBudget / Math.max(4 * aspect, Number.EPSILON)));
}

/**
 * Select a source-resolution bucket for display. The bucket is intentionally
 * monotonic and power-of-two based so small wheel increments do not churn
 * decoded representations. Export and print return 0, which means full
 * authoritative source data is required.
 */
export function selectRasterRepresentation(
  request: RasterRepresentationRequest,
): RasterRepresentationDecision {
  const intent = request.intent ?? 'interactive';
  if (intent === 'export' || intent === 'print') {
    return {
      maxSourceDim: 0,
      requiredSourceDim: 0,
      bucket: 0,
      reason: 'intent',
    };
  }

  const viewportMax = Math.max(1, request.viewportWidth, request.viewportHeight);
  const dpr = Math.max(1, Number.isFinite(request.devicePixelRatio) ? request.devicePixelRatio : 1);
  const zoom = Math.max(0.05, Number.isFinite(request.zoom) ? request.zoom : 1);
  const margin = request.cameraMoving ? INTERACTIVE_MARGIN : SETTLED_MARGIN;
  const projectedLongEdge = request.projectedLongEdge;
  const displayLongEdge =
    projectedLongEdge && Number.isFinite(projectedLongEdge) && projectedLongEdge > 0
      ? projectedLongEdge
      : viewportMax * dpr * zoom;
  const requiredSourceDim = displayLongEdge * margin;
  const maxBucket = request.cameraMoving ? MAX_INTERACTIVE_BUCKET : MAX_SETTLED_BUCKET;
  const budgetCap = previousPowerOfTwo(maxLongEdgeForDecodedBudget(request));
  const bucket = Math.min(
    maxBucket,
    budgetCap,
    Math.max(MIN_INTERACTIVE_BUCKET, nextPowerOfTwo(requiredSourceDim)),
  );

  return {
    maxSourceDim: bucket,
    requiredSourceDim,
    bucket,
    reason: request.cameraMoving ? 'camera-moving' : 'projected-size',
  };
}

/**
 * Hysteresis for an already resident representation. A caller may retain the
 * current bucket while the requested bucket is only marginally different.
 */
export function shouldChangeRasterBucket(
  currentBucket: number,
  requestedBucket: number,
  requiredSourceDim: number,
): boolean {
  if (currentBucket <= 0 || requestedBucket <= 0) return currentBucket !== requestedBucket;
  if (requestedBucket > currentBucket) return requiredSourceDim > currentBucket * 1.25;
  return requiredSourceDim < currentBucket * 0.7;
}

export interface ResidencyResource {
  resourceId: string;
  resourceType: string;
  documentId?: string;
  cpuBytes?: number;
  gpuBytes?: number;
  encodedBytes?: number;
  recreationCost?: number;
  reuseProbability?: number;
  visibility?: VisibilityState;
  priority?: ResourcePriority;
  fidelity?: FidelityLevel;
  representation?: RenderRepresentation;
  pinned?: boolean;
  lastUsedFrame?: number;
  lastUsedTime?: number;
}

export interface ResidencyDiagnostics {
  cpuBytes: number;
  gpuBytes: number;
  encodedBytes: number;
  resources: number;
  pinned: number;
  evictions: number;
  promotions: number;
  demotions: number;
  pressure: 'normal' | 'elevated' | 'high' | 'critical';
}

export interface ResidencyBudgets {
  cpuBytes: number;
  gpuBytes: number;
  encodedBytes: number;
}

/** Small, explainable resource ledger used by image/worker adapters. */
export class AdaptiveResidencyManager {
  private readonly resources = new Map<string, ResidencyResource>();
  private budgets: ResidencyBudgets;
  private frame = 0;
  private pressure: ResidencyDiagnostics['pressure'] = 'normal';
  private evictions = 0;
  private promotions = 0;
  private demotions = 0;

  constructor(budgets: ResidencyBudgets) {
    this.budgets = { ...budgets };
  }

  beginFrame(): void {
    this.frame++;
  }

  setBudgets(budgets: Partial<ResidencyBudgets>): void {
    this.budgets = { ...this.budgets, ...budgets };
    this.evictToBudget();
  }

  setPressure(pressure: ResidencyDiagnostics['pressure']): void {
    this.pressure = pressure;
    if (pressure === 'high' || pressure === 'critical') this.evictToBudget();
  }

  observe(resource: ResidencyResource): void {
    const previous = this.resources.get(resource.resourceId);
    if (previous && previous.fidelity !== resource.fidelity) {
      const order = [
        'placeholder',
        'thumbnail',
        'interactive-low',
        'interactive-medium',
        'interactive-high',
        'full',
        'export',
        'print',
      ];
      const oldIndex = order.indexOf(previous.fidelity ?? 'placeholder');
      const newIndex = order.indexOf(resource.fidelity ?? 'placeholder');
      if (newIndex > oldIndex) this.promotions++;
      if (newIndex < oldIndex) this.demotions++;
    }
    this.resources.set(resource.resourceId, {
      ...previous,
      ...resource,
      lastUsedFrame: this.frame,
      lastUsedTime: performance.now(),
    });
    this.evictToBudget();
  }

  touch(resourceId: string): void {
    const resource = this.resources.get(resourceId);
    if (!resource) return;
    this.resources.set(resourceId, {
      ...resource,
      lastUsedFrame: this.frame,
      lastUsedTime: performance.now(),
    });
  }

  pin(resourceId: string, pinned = true): void {
    const resource = this.resources.get(resourceId);
    if (resource) this.resources.set(resourceId, { ...resource, pinned });
  }

  releaseDocument(documentId: string): number {
    let released = 0;
    for (const [resourceId, resource] of this.resources) {
      if (resource.documentId === documentId) {
        this.resources.delete(resourceId);
        released++;
      }
    }
    return released;
  }

  diagnostics(): ResidencyDiagnostics {
    let cpuBytes = 0;
    let gpuBytes = 0;
    let encodedBytes = 0;
    let pinned = 0;
    for (const resource of this.resources.values()) {
      cpuBytes += resource.cpuBytes ?? 0;
      gpuBytes += resource.gpuBytes ?? 0;
      encodedBytes += resource.encodedBytes ?? 0;
      if (resource.pinned) pinned++;
    }
    return {
      cpuBytes,
      gpuBytes,
      encodedBytes,
      resources: this.resources.size,
      pinned,
      evictions: this.evictions,
      promotions: this.promotions,
      demotions: this.demotions,
      pressure: this.pressure,
    };
  }

  private evictToBudget(): void {
    const overCpu = () => this.total('cpuBytes') > this.budgets.cpuBytes;
    const overGpu = () => this.total('gpuBytes') > this.budgets.gpuBytes;
    const overEncoded = () => this.total('encodedBytes') > this.budgets.encodedBytes;
    while (overCpu() || overGpu() || overEncoded()) {
      let candidate: ResidencyResource | undefined;
      let candidateScore = -Infinity;
      for (const resource of this.resources.values()) {
        if (resource.pinned || resource.visibility === 'critical-visible') continue;
        const age = this.frame - (resource.lastUsedFrame ?? 0);
        const size = (resource.cpuBytes ?? 0) + (resource.gpuBytes ?? 0);
        const score =
          age * 4 +
          size / (1024 * 1024) -
          (resource.recreationCost ?? 0) * 2 -
          (resource.reuseProbability ?? 0) * 3;
        if (score > candidateScore) {
          candidate = resource;
          candidateScore = score;
        }
      }
      if (!candidate) break;
      this.resources.delete(candidate.resourceId);
      this.evictions++;
    }
  }

  private total(key: 'cpuBytes' | 'gpuBytes' | 'encodedBytes'): number {
    let total = 0;
    for (const resource of this.resources.values()) total += resource[key] ?? 0;
    return total;
  }
}

let globalResidencyManager: AdaptiveResidencyManager | null = null;

/** Shared policy ledger for the editor render session and diagnostics. */
export function getAdaptiveResidencyManager(): AdaptiveResidencyManager {
  if (!globalResidencyManager) {
    globalResidencyManager = new AdaptiveResidencyManager({
      cpuBytes: 256 * 1024 * 1024,
      gpuBytes: 128 * 1024 * 1024,
      encodedBytes: 512 * 1024 * 1024,
    });
  }
  return globalResidencyManager;
}

export function resetAdaptiveResidencyManager(): void {
  globalResidencyManager = null;
}
