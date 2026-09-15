/**
 * Persisted, provider-independent generative editing provenance.
 *
 * Pixels live in the normal Document.assets table. This record keeps the
 * recipe and source relationship inspectable without making rendering depend
 * on an installed model or a provider retaining a response.
 */

export const GENERATIVE_EDIT_SCHEMA_VERSION = 2 as const;

export type GenerativeEditMode = 'fill' | 'remove' | 'replace' | 'expand';
export type GenerativeEditQuality = 'draft' | 'balanced' | 'quality';
export type GenerativeEditProviderKind = 'local' | 'remote';
export type GenerativeEditRuntime =
  | 'patchmatch'
  | 'wasm'
  | 'webgpu'
  | 'native-cpu'
  | 'native-accelerated'
  | 'remote';

/** Exact model input frame used after aspect-ratio preparation. */
export interface GenerativeEditInputFrame {
  contractId: string;
  preprocessingVersion: string;
  width: number;
  height: number;
}

export interface GenerativeEditProvider {
  kind: GenerativeEditProviderKind;
  id: string;
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: GenerativeEditRuntime;
  /** Optional for reconstruction/legacy providers; present for diffusion results. */
  inputFrame?: GenerativeEditInputFrame;
}

/**
 * The source of the editable mask recorded with a generative edit. This is
 * provenance, not a claim that an automated proposal understood a semantic
 * object name; prompted proposals still require the user's visible review.
 */
export type GenerativeEditSelectionSource =
  | 'brush'
  | 'pixel-selection'
  | 'layer-mask'
  | 'background-removal'
  | 'image-alpha'
  | 'object-selection'
  | 'persisted';

export type GenerativeEditSelectionVerification =
  | 'explicit-user-review'
  | 'object-selection-reviewed'
  | 'carried-forward';

export interface GenerativeEditSelectionDiagnostics {
  hardPixels: number;
  hardCoverage: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  componentCount: number;
  anchoredComponentCount: number;
  anchoredCoverage: number;
  unanchoredCoverage: number;
  ambiguous: boolean;
}

/**
 * Auditable selection evidence. The actual source mask remains the raster
 * mask asset referenced by `masks`; this compact record explains how that
 * mask entered the workflow and which reviewed prompted candidate it came
 * from, when applicable.
 */
export interface GenerativeEditSelectionEvidence {
  schemaVersion: 1;
  source: GenerativeEditSelectionSource;
  verification: GenerativeEditSelectionVerification;
  /** Deterministic identity of the final persisted user-mask data URL. */
  maskFingerprint: string;
  /** Time of the final review/apply checkpoint, in epoch milliseconds. */
  reviewedAt: number;
  sourceFingerprint?: string;
  mappingFingerprint?: string;
  candidateReviewKey?: string;
  candidateSetId?: string;
  candidateIndex?: number;
  candidateCount?: number;
  rejectedCandidateCount?: number;
  candidateScore?: number;
  candidateScoreSource?: string;
  promptContainment?: number;
  promptCoordinateSpace?: 'source-image-normalized';
  promptPoints?: Array<{ x: number; y: number; label: 0 | 1 }>;
  promptBox?: { x1: number; y1: number; x2: number; y2: number };
  candidateReviewedAt?: number;
  diagnostics?: GenerativeEditSelectionDiagnostics;
}

export interface GenerativeEditSettings {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  quality: GenerativeEditQuality;
  contextPadding: number;
  /** Signed source-pixel refinement: positive grows, negative shrinks. */
  maskExpansion: number;
  feather: number;
  /** Prompt-conditioning strength for providers that expose it. */
  strength?: number;
  /** Sampling steps for providers that expose it. */
  steps?: number;
  /** Classifier-free guidance for providers that expose it. */
  guidanceScale?: number;
  /** Separate image-conditioning guidance for inpainting providers. */
  imageGuidanceScale?: number;
}

export interface GenerativeEditMaskSet {
  /** The mask as edited by the user before provider refinement. */
  userMaskAssetId: string;
  /** The provider-facing mask after expansion/feathering. */
  inferenceMaskAssetId?: string;
  /** The coverage used by the final source/result composite. */
  compositeMaskAssetId?: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  coordinateSpace: 'source-image-pixels';
  /** Dimensions/origin of the editable mask when it differs from inference. */
  userWidth?: number;
  userHeight?: number;
  userOffsetX?: number;
  userOffsetY?: number;
  /**
   * Exact non-zero bounds of the persisted user mask in source pixels.
   * Reopening can decode this bounded region instead of trusting a reduced
   * review preview, which matters for thin or edge-touching selections.
   */
  userBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface GenerativeEditOutputFrame {
  /** Source-image pixel frame containing the generated result. */
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  coordinateSpace: 'source-image-pixels';
}

export interface GenerativeEditVariation {
  id: string;
  assetId: string;
  /**
   * New bounded browser/desktop results are transparent region overlays. An
   * omitted value means the legacy asset is a complete output frame.
   */
  assetKind?: 'full-output' | 'region-overlay';
  /** Small preview asset used by candidate cards before a full result is selected. */
  thumbnailAssetId?: string;
  width: number;
  height: number;
  createdAt: number;
  seed?: number;
  settings?: GenerativeEditSettings;
  /** Optional prepared context retained for reproducibility/debugging. */
  contextAssetId?: string;
  outputFrame?: GenerativeEditOutputFrame;
  provider?: GenerativeEditProvider;
}

export interface GenerativeEditRecord {
  schemaVersion: typeof GENERATIVE_EDIT_SCHEMA_VERSION;
  id: string;
  mode: GenerativeEditMode;
  sourceNodeId: string;
  /** Previous accepted edit on the same source, when this is a repeated edit. */
  parentEditId?: string;
  sourceAssetId?: string;
  /** Immutable source snapshot used even if the source fill is later replaced. */
  sourceSnapshotAssetId?: string;
  sourceLocator: string;
  sourceRevision: number;
  placementRevision: string;
  masks: GenerativeEditMaskSet;
  /** Optional for legacy records; new edits record how the mask was selected. */
  selectionEvidence?: GenerativeEditSelectionEvidence;
  outputFrame: GenerativeEditOutputFrame;
  /** Compatibility alias retained for readers of the first record shape. */
  maskAssetId: string;
  maskWidth: number;
  maskHeight: number;
  maskCoordinateSpace: 'source-image-pixels';
  settings: GenerativeEditSettings;
  provider: GenerativeEditProvider;
  variations: GenerativeEditVariation[];
  activeVariationId?: string;
  acceptedVariationId?: string;
  resultNodeId?: string;
  createdAt: number;
  updatedAt: number;
}

const MODES = new Set<GenerativeEditMode>(['fill', 'remove', 'replace', 'expand']);
const QUALITIES = new Set<GenerativeEditQuality>(['draft', 'balanced', 'quality']);
const PROVIDER_KINDS = new Set<GenerativeEditProviderKind>(['local', 'remote']);
const RUNTIMES = new Set<GenerativeEditRuntime>([
  'patchmatch',
  'wasm',
  'webgpu',
  'native-cpu',
  'native-accelerated',
  'remote',
]);
const SELECTION_SOURCES = new Set<GenerativeEditSelectionSource>([
  'brush',
  'pixel-selection',
  'layer-mask',
  'background-removal',
  'image-alpha',
  'object-selection',
  'persisted',
]);
const SELECTION_VERIFICATIONS = new Set<GenerativeEditSelectionVerification>([
  'explicit-user-review',
  'object-selection-reviewed',
  'carried-forward',
]);

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function validProvider(value: unknown): value is GenerativeEditProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Partial<GenerativeEditProvider>;
  const inputFrame = provider.inputFrame;
  const validInputFrame =
    inputFrame === undefined ||
    (inputFrame !== null &&
      typeof inputFrame === 'object' &&
      typeof inputFrame.contractId === 'string' &&
      inputFrame.contractId.length > 0 &&
      typeof inputFrame.preprocessingVersion === 'string' &&
      inputFrame.preprocessingVersion.length > 0 &&
      Number.isSafeInteger(inputFrame.width) &&
      inputFrame.width > 0 &&
      inputFrame.width <= 4096 &&
      Number.isSafeInteger(inputFrame.height) &&
      inputFrame.height > 0 &&
      inputFrame.height <= 4096);
  return (
    PROVIDER_KINDS.has(provider.kind as GenerativeEditProviderKind) &&
    typeof provider.id === 'string' &&
    provider.id.length > 0 &&
    RUNTIMES.has(provider.runtime as GenerativeEditRuntime) &&
    validInputFrame
  );
}

function validSettings(value: unknown): value is GenerativeEditSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<GenerativeEditSettings>;
  return (
    QUALITIES.has(settings.quality as GenerativeEditQuality) &&
    finiteNonNegative(settings.contextPadding) &&
    finiteBetween(settings.maskExpansion, -64, 64) &&
    finiteNonNegative(settings.feather) &&
    (settings.prompt === undefined || typeof settings.prompt === 'string') &&
    (settings.negativePrompt === undefined || typeof settings.negativePrompt === 'string') &&
    (settings.seed === undefined ||
      (typeof settings.seed === 'number' && Number.isFinite(settings.seed))) &&
    (settings.strength === undefined ||
      (typeof settings.strength === 'number' &&
        Number.isFinite(settings.strength) &&
        settings.strength >= 0 &&
        settings.strength <= 1)) &&
    (settings.steps === undefined ||
      (Number.isSafeInteger(settings.steps) && settings.steps > 0 && settings.steps <= 200)) &&
    (settings.guidanceScale === undefined ||
      (typeof settings.guidanceScale === 'number' &&
        Number.isFinite(settings.guidanceScale) &&
        settings.guidanceScale >= 0 &&
        settings.guidanceScale <= 50)) &&
    (settings.imageGuidanceScale === undefined ||
      (typeof settings.imageGuidanceScale === 'number' &&
        Number.isFinite(settings.imageGuidanceScale) &&
        settings.imageGuidanceScale >= 0 &&
        settings.imageGuidanceScale <= 50))
  );
}

function validMaskSet(value: unknown): value is GenerativeEditMaskSet {
  if (!value || typeof value !== 'object') return false;
  const masks = value as Partial<GenerativeEditMaskSet>;
  const userWidth =
    typeof masks.userWidth === 'number'
      ? masks.userWidth
      : typeof masks.width === 'number'
        ? masks.width
        : 0;
  const userHeight =
    typeof masks.userHeight === 'number'
      ? masks.userHeight
      : typeof masks.height === 'number'
        ? masks.height
        : 0;
  const userBounds = masks.userBounds;
  const validUserBounds =
    userBounds === undefined ||
    (typeof userBounds === 'object' &&
      userBounds !== null &&
      Number.isSafeInteger(userBounds.x) &&
      Number.isSafeInteger(userBounds.y) &&
      Number.isSafeInteger(userBounds.width) &&
      Number.isSafeInteger(userBounds.height) &&
      userBounds.x >= 0 &&
      userBounds.y >= 0 &&
      userBounds.width > 0 &&
      userBounds.height > 0 &&
      userBounds.x + userBounds.width <= userWidth &&
      userBounds.y + userBounds.height <= userHeight);
  return (
    typeof masks.userMaskAssetId === 'string' &&
    masks.userMaskAssetId.length > 0 &&
    (masks.inferenceMaskAssetId === undefined ||
      (typeof masks.inferenceMaskAssetId === 'string' && masks.inferenceMaskAssetId.length > 0)) &&
    (masks.compositeMaskAssetId === undefined ||
      (typeof masks.compositeMaskAssetId === 'string' && masks.compositeMaskAssetId.length > 0)) &&
    Number.isSafeInteger(masks.width) &&
    (masks.width ?? 0) > 0 &&
    Number.isSafeInteger(masks.height) &&
    (masks.height ?? 0) > 0 &&
    Number.isSafeInteger(masks.offsetX) &&
    Number.isSafeInteger(masks.offsetY) &&
    masks.coordinateSpace === 'source-image-pixels' &&
    (masks.userWidth === undefined ||
      (Number.isSafeInteger(masks.userWidth) && (masks.userWidth ?? 0) > 0)) &&
    (masks.userHeight === undefined ||
      (Number.isSafeInteger(masks.userHeight) && (masks.userHeight ?? 0) > 0)) &&
    (masks.userOffsetX === undefined || Number.isSafeInteger(masks.userOffsetX)) &&
    (masks.userOffsetY === undefined || Number.isSafeInteger(masks.userOffsetY)) &&
    validUserBounds
  );
}

function validSelectionEvidence(value: unknown): value is GenerativeEditSelectionEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<GenerativeEditSelectionEvidence>;
  const validBounds = (bounds: unknown): boolean => {
    if (bounds === undefined) return true;
    if (!bounds || typeof bounds !== 'object') return false;
    const candidate = bounds as Record<string, unknown>;
    return (
      Number.isSafeInteger(candidate.x) &&
      Number.isSafeInteger(candidate.y) &&
      Number.isSafeInteger(candidate.width) &&
      Number.isSafeInteger(candidate.height) &&
      (candidate.width as number) > 0 &&
      (candidate.height as number) > 0
    );
  };
  const validPoints =
    evidence.promptPoints === undefined ||
    (Array.isArray(evidence.promptPoints) &&
      evidence.promptPoints.every(
        (point) =>
          point !== null &&
          typeof point === 'object' &&
          finiteBetween(point.x, 0, 1) &&
          finiteBetween(point.y, 0, 1) &&
          (point.label === 0 || point.label === 1),
      ));
  const validBox =
    evidence.promptBox === undefined ||
    (evidence.promptBox !== null &&
      typeof evidence.promptBox === 'object' &&
      finiteBetween(evidence.promptBox.x1, 0, 1) &&
      finiteBetween(evidence.promptBox.y1, 0, 1) &&
      finiteBetween(evidence.promptBox.x2, 0, 1) &&
      finiteBetween(evidence.promptBox.y2, 0, 1) &&
      evidence.promptBox.x2 > evidence.promptBox.x1 &&
      evidence.promptBox.y2 > evidence.promptBox.y1);
  const diagnostics = evidence.diagnostics;
  const validDiagnostics =
    diagnostics === undefined ||
    (diagnostics !== null &&
      typeof diagnostics === 'object' &&
      Number.isSafeInteger(diagnostics.hardPixels) &&
      (diagnostics.hardPixels ?? -1) >= 0 &&
      finiteBetween(diagnostics.hardCoverage, 0, 1) &&
      validBounds(diagnostics.bounds) &&
      Number.isSafeInteger(diagnostics.componentCount) &&
      (diagnostics.componentCount ?? -1) >= 0 &&
      Number.isSafeInteger(diagnostics.anchoredComponentCount) &&
      (diagnostics.anchoredComponentCount ?? -1) >= 0 &&
      finiteBetween(diagnostics.anchoredCoverage, 0, 1) &&
      finiteBetween(diagnostics.unanchoredCoverage, 0, 1) &&
      typeof diagnostics.ambiguous === 'boolean');
  const candidateFieldsAreValid =
    (evidence.candidateReviewKey === undefined ||
      (typeof evidence.candidateReviewKey === 'string' &&
        evidence.candidateReviewKey.length > 0)) &&
    (evidence.candidateSetId === undefined ||
      (typeof evidence.candidateSetId === 'string' && evidence.candidateSetId.length > 0)) &&
    (evidence.candidateIndex === undefined ||
      (Number.isSafeInteger(evidence.candidateIndex) && evidence.candidateIndex >= 0)) &&
    (evidence.candidateCount === undefined ||
      (Number.isSafeInteger(evidence.candidateCount) && evidence.candidateCount > 0)) &&
    (evidence.rejectedCandidateCount === undefined ||
      (Number.isSafeInteger(evidence.rejectedCandidateCount) &&
        evidence.rejectedCandidateCount >= 0)) &&
    (evidence.candidateScore === undefined || Number.isFinite(evidence.candidateScore)) &&
    (evidence.candidateScoreSource === undefined ||
      (typeof evidence.candidateScoreSource === 'string' &&
        evidence.candidateScoreSource.length > 0)) &&
    (evidence.candidateReviewedAt === undefined || finiteNonNegative(evidence.candidateReviewedAt));
  const isObjectSelection = evidence.source === 'object-selection';
  return (
    evidence.schemaVersion === 1 &&
    SELECTION_SOURCES.has(evidence.source as GenerativeEditSelectionSource) &&
    SELECTION_VERIFICATIONS.has(evidence.verification as GenerativeEditSelectionVerification) &&
    typeof evidence.maskFingerprint === 'string' &&
    evidence.maskFingerprint.length > 0 &&
    finiteNonNegative(evidence.reviewedAt) &&
    (evidence.sourceFingerprint === undefined ||
      (typeof evidence.sourceFingerprint === 'string' && evidence.sourceFingerprint.length > 0)) &&
    (evidence.mappingFingerprint === undefined ||
      (typeof evidence.mappingFingerprint === 'string' &&
        evidence.mappingFingerprint.length > 0)) &&
    (evidence.promptCoordinateSpace === undefined ||
      evidence.promptCoordinateSpace === 'source-image-normalized') &&
    (evidence.promptPoints === undefined || evidence.promptCoordinateSpace !== undefined) &&
    (evidence.promptBox === undefined || evidence.promptCoordinateSpace !== undefined) &&
    (evidence.promptContainment === undefined || finiteBetween(evidence.promptContainment, 0, 1)) &&
    validPoints &&
    validBox &&
    validDiagnostics &&
    candidateFieldsAreValid &&
    (!isObjectSelection ||
      (evidence.verification === 'object-selection-reviewed' &&
        typeof evidence.sourceFingerprint === 'string' &&
        evidence.sourceFingerprint.length > 0 &&
        typeof evidence.mappingFingerprint === 'string' &&
        evidence.mappingFingerprint.length > 0 &&
        typeof evidence.candidateReviewKey === 'string' &&
        evidence.candidateReviewKey.length > 0 &&
        typeof evidence.candidateSetId === 'string' &&
        evidence.candidateSetId.length > 0 &&
        Number.isSafeInteger(evidence.candidateIndex) &&
        (evidence.candidateIndex ?? -1) >= 0 &&
        Number.isSafeInteger(evidence.candidateCount) &&
        (evidence.candidateCount ?? 0) > 0 &&
        finiteNonNegative(evidence.candidateReviewedAt)))
  );
}

function validOutputFrame(value: unknown): value is GenerativeEditOutputFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<GenerativeEditOutputFrame>;
  return (
    Number.isSafeInteger(frame.x) &&
    Number.isSafeInteger(frame.y) &&
    Number.isSafeInteger(frame.width) &&
    (frame.width ?? 0) > 0 &&
    Number.isSafeInteger(frame.height) &&
    (frame.height ?? 0) > 0 &&
    Number.isSafeInteger(frame.sourceWidth) &&
    (frame.sourceWidth ?? 0) > 0 &&
    Number.isSafeInteger(frame.sourceHeight) &&
    (frame.sourceHeight ?? 0) > 0 &&
    frame.coordinateSpace === 'source-image-pixels'
  );
}

function validVariation(value: unknown): value is GenerativeEditVariation {
  if (!value || typeof value !== 'object') return false;
  const variation = value as Partial<GenerativeEditVariation>;
  const width = variation.width;
  const height = variation.height;
  return (
    typeof variation.id === 'string' &&
    variation.id.length > 0 &&
    typeof variation.assetId === 'string' &&
    variation.assetId.length > 0 &&
    (variation.assetKind === undefined ||
      variation.assetKind === 'full-output' ||
      variation.assetKind === 'region-overlay') &&
    (variation.thumbnailAssetId === undefined ||
      (typeof variation.thumbnailAssetId === 'string' && variation.thumbnailAssetId.length > 0)) &&
    Number.isSafeInteger(width) &&
    (width ?? 0) > 0 &&
    Number.isSafeInteger(height) &&
    (height ?? 0) > 0 &&
    finiteNonNegative(variation.createdAt) &&
    (variation.provider === undefined || validProvider(variation.provider)) &&
    (variation.seed === undefined ||
      (typeof variation.seed === 'number' && Number.isFinite(variation.seed))) &&
    (variation.settings === undefined || validSettings(variation.settings)) &&
    (variation.contextAssetId === undefined ||
      (typeof variation.contextAssetId === 'string' && variation.contextAssetId.length > 0)) &&
    (variation.outputFrame === undefined || validOutputFrame(variation.outputFrame))
  );
}

/** Return a stable validation error for a persisted generative edit record. */
export function validateGenerativeEdit(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Generative edit must be an object';
  const edit = value as Partial<GenerativeEditRecord>;
  const sourceRevision = edit.sourceRevision;
  const maskWidth = edit.maskWidth;
  const maskHeight = edit.maskHeight;
  if (edit.schemaVersion !== GENERATIVE_EDIT_SCHEMA_VERSION) {
    return `Unsupported generative edit schema version: ${String(edit.schemaVersion)}`;
  }
  if (typeof edit.id !== 'string' || edit.id.length === 0) return 'Generative edit id is required';
  if (!MODES.has(edit.mode as GenerativeEditMode)) return 'Generative edit mode is invalid';
  if (typeof edit.sourceNodeId !== 'string' || edit.sourceNodeId.length === 0) {
    return 'Generative edit sourceNodeId is required';
  }
  if (
    edit.parentEditId !== undefined &&
    (typeof edit.parentEditId !== 'string' ||
      edit.parentEditId.length === 0 ||
      edit.parentEditId === edit.id)
  ) {
    return 'Generative edit parentEditId is invalid';
  }
  if (typeof edit.sourceLocator !== 'string') return 'Generative edit sourceLocator is invalid';
  if (!Number.isSafeInteger(sourceRevision) || (sourceRevision ?? -1) < 0) {
    return 'Generative edit sourceRevision is invalid';
  }
  if (typeof edit.placementRevision !== 'string' || edit.placementRevision.length === 0) {
    return 'Generative edit placementRevision is required';
  }
  if (!validMaskSet(edit.masks)) return 'Generative edit masks are invalid';
  if (edit.selectionEvidence !== undefined && !validSelectionEvidence(edit.selectionEvidence)) {
    return 'Generative edit selection evidence is invalid';
  }
  if (!validOutputFrame(edit.outputFrame)) return 'Generative edit outputFrame is invalid';
  if (
    edit.sourceSnapshotAssetId !== undefined &&
    (typeof edit.sourceSnapshotAssetId !== 'string' || edit.sourceSnapshotAssetId.length === 0)
  ) {
    return 'Generative edit sourceSnapshotAssetId is invalid';
  }
  if (typeof edit.maskAssetId !== 'string' || edit.maskAssetId.length === 0) {
    return 'Generative edit maskAssetId is required';
  }
  if (!Number.isSafeInteger(maskWidth) || (maskWidth ?? 0) <= 0)
    return 'Generative edit maskWidth is invalid';
  if (!Number.isSafeInteger(maskHeight) || (maskHeight ?? 0) <= 0)
    return 'Generative edit maskHeight is invalid';
  if (edit.maskCoordinateSpace !== 'source-image-pixels') {
    return 'Generative edit maskCoordinateSpace must be source-image-pixels';
  }
  if (!validSettings(edit.settings)) return 'Generative edit settings are invalid';
  if (!validProvider(edit.provider)) return 'Generative edit provider is invalid';
  if (!Array.isArray(edit.variations) || !edit.variations.every(validVariation)) {
    return 'Generative edit variations are invalid';
  }
  const variationIds = new Set(edit.variations.map((variation) => variation.id));
  if (edit.activeVariationId !== undefined && !variationIds.has(edit.activeVariationId)) {
    return 'Generative edit active variation is missing';
  }
  if (edit.acceptedVariationId !== undefined && !variationIds.has(edit.acceptedVariationId)) {
    return 'Generative edit accepted variation is missing';
  }
  if (!finiteNonNegative(edit.createdAt) || !finiteNonNegative(edit.updatedAt)) {
    return 'Generative edit timestamps are invalid';
  }
  return null;
}

/** Keep only well-formed persisted records; malformed records cannot block a document load. */
export function normalizeGenerativeEdits(
  value: unknown,
): Record<string, GenerativeEditRecord> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const valid = Object.fromEntries(
    Object.entries(value).filter(([id, edit]) => {
      return id.length > 0 && validateGenerativeEdit(edit) === null;
    }),
  ) as Record<string, GenerativeEditRecord>;
  return Object.keys(valid).length > 0 ? valid : undefined;
}
