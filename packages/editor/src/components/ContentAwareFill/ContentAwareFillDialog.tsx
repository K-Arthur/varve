import {
  buildExpandedFrame,
  type CachedImage,
  type ContentAwareFillQuality,
  cachedImageDims,
  computeExpandPlan,
  downloadNativeGenerativeModel,
  type ExpandPlan,
  type ExpandWorkingFrame,
  estimateExpandGenerationResolution,
  expandPlanOutputFrame,
  extractBoundedContext,
  GenerativeEditError,
  type GenerativeEditMode,
  type GenerativeEditResult,
  GenerativeJobController,
  type GenerativeJobSnapshot,
  getGenerativeEditCapabilities,
  getImageCache,
  getModelLoader,
  getNativeGenerativeModelStatus,
  importNativeGenerativeModel,
  isWasmModelSafe,
  NATIVE_GENERATIVE_MODEL_PROFILE,
  planExpandWorkingFrame,
  QUALITY_DESCRIPTIONS,
  QUALITY_LABELS,
  qualifyNativeGenerativeModel,
  runGenerativeEdit,
} from '@varve/engine';
import {
  createEmbeddedAsset,
  decodedDataUrlByteLength,
  type GenerativeEditRecord,
  type GenerativeEditVariation,
  hashContent,
  imageShapeSrc,
  isImageShape,
  resolveRasterMaskAsset,
  type ShapeNode,
  sha256Utf8,
} from '@varve/scene';
import { Button, Switch } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePlacementRevision } from '../../backgroundRemoval/SubjectIsolationService';
import { useEditor } from '../../context';
import { replaceImageShapeContent } from '../../imageOperations';
import { decodeRasterMaskDataUrl, rasterizeAreaSelectionForNode } from '../../tools/selectionMask';
import type { ExpandPadding } from './expandCanvas';
import { composeExpandedFullResolution } from './expandComposition';
import {
  EXPAND_ASPECT_PRESETS,
  type ExpandAnchor,
  expandPaddingForAspectRatio,
  expandPaddingForOutputSize,
} from './expandControls';
import {
  computeSourceRegionFromPreviewMask,
  encodePreviewMaskAtSourceSize,
  loadImageRegionToImageData,
  mapSourceRegionToProxy,
  renderGeneratedRegionToPatchCanvas,
  renderGeneratedRegionToPreviewCanvas,
  type SourceImageRegion,
  samplePreviewMaskToRegion,
  workingPixelBudgetForTier,
  workingRasterDimensions,
} from './generationRaster';
import {
  combineMaskCoverage,
  type MaskCombineOperation,
  maskCoverageFromRgba,
  putMaskCoverage,
  refineGenerativeMask,
  resizeMaskCoverage,
} from './maskOperations';
import { mergeGenerativeVariations } from './variationSession';
import './ContentAwareFillDialog.css';

const MODEL_ID = 'lama-inpainting';
const DEFAULT_BRUSH_SIZE = 28;
const MAX_BATCH_VARIATIONS = 4;
const MAX_RETAINED_VARIATIONS = 8;
const MAX_PREVIEW_PIXELS = 2_000_000;
const MAX_VARIATION_THUMBNAIL_DIMENSION = 256;
const MAX_SOURCE_PROXY_DIMENSION = 1536;

function previewRasterDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function maskCoverageDataUrl(coverage: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  putMaskCoverage(context, coverage, { width, height });
  return canvas.toDataURL('image/png');
}

function imageDataDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function thumbnailDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_VARIATION_THUMBNAIL_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Encode only a bounded preview for inactive variation cards. */
function thumbnailDataUrlFromCanvas(source: HTMLCanvasElement): string {
  const dimensions = thumbnailDimensions(source.width, source.height);
  if (dimensions.width === source.width && dimensions.height === source.height) {
    return source.toDataURL('image/png');
  }
  const thumbnail = document.createElement('canvas');
  thumbnail.width = dimensions.width;
  thumbnail.height = dimensions.height;
  const context = thumbnail.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  return thumbnail.toDataURL('image/png');
}

async function loadBoundedImageSource(
  src: string,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): Promise<CachedImage> {
  return getImageCache().loadAtSize(
    src,
    maxDimension,
    sourceWidth > 0 && sourceHeight > 0 ? { width: sourceWidth, height: sourceHeight } : undefined,
  );
}

interface VisibleSourceOverlay {
  src: string;
  width: number;
  height: number;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  editId: string;
}

function validOverlaySourceFrame(
  frame: unknown,
): frame is { x: number; y: number; width: number; height: number } {
  if (!frame || typeof frame !== 'object') return false;
  const candidate = frame as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  );
}

/**
 * Build the currently visible source at proxy resolution. Bounded accepted
 * edits are stored as transparent patches above the immutable base fill; a
 * repeated edit must see those patches in its context or it would regress to
 * the original pixels on the next generation.
 */
async function loadVisibleImageSource(
  source: string,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  overlays: readonly VisibleSourceOverlay[],
): Promise<CachedImage | HTMLCanvasElement> {
  const base = await loadBoundedImageSource(source, sourceWidth, sourceHeight, maxDimension);
  if (overlays.length === 0) return base;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Visible source dimensions are unavailable');
  }
  const baseDimensions = cachedImageDims(base);
  if (!baseDimensions.width || !baseDimensions.height) {
    throw new Error('Visible source proxy dimensions are unavailable');
  }
  const canvas = document.createElement('canvas');
  canvas.width = baseDimensions.width;
  canvas.height = baseDimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Visible source proxy canvas is unavailable');
  context.drawImage(base, 0, 0, canvas.width, canvas.height);

  for (const overlay of overlays) {
    const patch = await loadBoundedImageSource(
      overlay.src,
      overlay.width,
      overlay.height,
      maxDimension,
    );
    const patchDimensions = cachedImageDims(patch);
    if (!patchDimensions.width || !patchDimensions.height) {
      throw new Error('Visible generative overlay dimensions are unavailable');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      patch,
      0,
      0,
      patchDimensions.width,
      patchDimensions.height,
      (overlay.x / sourceWidth) * canvas.width,
      (overlay.y / sourceHeight) * canvas.height,
      (overlay.frameWidth / sourceWidth) * canvas.width,
      (overlay.frameHeight / sourceHeight) * canvas.height,
    );
  }
  return canvas;
}

function imageSourceDims(image: CachedImage | HTMLCanvasElement): {
  width: number;
  height: number;
} {
  return image instanceof HTMLCanvasElement
    ? { width: image.width, height: image.height }
    : cachedImageDims(image);
}

function visibleSourceOverlays(
  node: ShapeNode | null,
  assets:
    | Record<string, { dataUrl?: string; naturalWidth?: number; naturalHeight?: number }>
    | undefined,
): VisibleSourceOverlay[] {
  if (!node) return [];
  return (node.fills ?? []).flatMap((fill) => {
    if (fill.type !== 'image' || !fill.image?.generativeEditOverlay) return [];
    const image = fill.image;
    const overlay = image.generativeEditOverlay;
    if (!overlay) return [];
    const asset = image.assetId ? assets?.[image.assetId] : undefined;
    const src = asset?.dataUrl ?? image.src;
    const width = image.imageWidth ?? asset?.naturalWidth ?? 0;
    const height = image.imageHeight ?? asset?.naturalHeight ?? 0;
    const sourceFrame = validOverlaySourceFrame(overlay.sourceFrame) ? overlay.sourceFrame : null;
    const x = sourceFrame?.x ?? image.x;
    const y = sourceFrame?.y ?? image.y;
    const imageScale = Number.isFinite(image.scale) && image.scale > 0 ? image.scale : 1;
    const frameWidth = sourceFrame?.width ?? width * imageScale;
    const frameHeight = sourceFrame?.height ?? height * imageScale;
    if (
      !src ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(frameWidth) ||
      !Number.isFinite(frameHeight) ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return [];
    }
    return [
      {
        src,
        width,
        height,
        x,
        y,
        frameWidth,
        frameHeight,
        editId: overlay.editId,
      },
    ];
  });
}

async function loadImageToImageData(
  src: string,
  targetWidth?: number,
  targetHeight?: number,
  sourceWidth = 0,
  sourceHeight = 0,
): Promise<ImageData> {
  if (!targetWidth || !targetHeight || targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('A bounded target size is required');
  }
  const image = await loadBoundedImageSource(
    src,
    sourceWidth,
    sourceHeight,
    Math.max(targetWidth, targetHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get canvas context');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Rehydrate a persisted candidate for comparison without rerunning inference. */
function persistedVariationResult(
  edit: GenerativeEditRecord,
  variation: GenerativeEditVariation,
  imageData: ImageData,
): GenerativeEditResult {
  const outputFrame = variation.outputFrame ?? edit.outputFrame;
  return {
    imageData,
    width: variation.width,
    height: variation.height,
    filledBounds: {
      x: outputFrame.x,
      y: outputFrame.y,
      w: outputFrame.width,
      h: outputFrame.height,
    },
    mode: edit.mode,
    quality: variation.settings?.quality ?? edit.settings.quality,
    provider: variation.provider ?? edit.provider,
    processingTimeMs: 0,
    warnings: [],
  };
}

/**
 * Keep candidate metadata available without retaining another decoded full
 * raster. The persisted asset/data URL remains the source of truth for the
 * preview and Apply path; ImageData is only needed by the inference result
 * type and is not read by the dialog for an unloaded candidate.
 */
function unloadedVariationImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4), 1, 1);
}

function metadataOnlyVariationResult(result: GenerativeEditResult): GenerativeEditResult {
  return { ...result, imageData: unloadedVariationImageData() };
}

/** Rebuild a bounded full-composition preview from a persisted candidate. */
async function persistedVariationPreviewDataUrl(
  basePreview: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  variation: GenerativeEditVariation,
  asset: { dataUrl: string; naturalWidth: number; naturalHeight: number },
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = basePreview.width;
  canvas.height = basePreview.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preview canvas unavailable');
  context.drawImage(basePreview, 0, 0);

  const image = await loadBoundedImageSource(
    asset.dataUrl,
    asset.naturalWidth,
    asset.naturalHeight,
    Math.max(basePreview.width, basePreview.height),
  );
  const outputFrame = variation.outputFrame;
  const frame = outputFrame
    ? outputFrame
    : {
        x: 0,
        y: 0,
        width: sourceWidth,
        height: sourceHeight,
      };
  context.drawImage(
    image,
    0,
    0,
    cachedImageDims(image).width,
    cachedImageDims(image).height,
    (frame.x / sourceWidth) * basePreview.width,
    (frame.y / sourceHeight) * basePreview.height,
    (frame.width / sourceWidth) * basePreview.width,
    (frame.height / sourceHeight) * basePreview.height,
  );
  return canvas.toDataURL('image/png');
}

export interface ContentAwareFillDialogProps {
  nodeId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export function ContentAwareFillDialog({
  nodeId,
  isOpen,
  onClose,
  onApplied,
}: ContentAwareFillDialogProps) {
  const {
    state,
    updateDoc,
    announce,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    setSelection,
    setTool,
  } = useEditor();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const jobControllerRef = useRef(new GenerativeJobController());
  const downloadAbortRef = useRef<AbortController | null>(null);
  const diffusionDownloadAbortRef = useRef<AbortController | null>(null);
  const qualificationAbortRef = useRef<AbortController | null>(null);
  // The ownership token protects against a late status response even after
  // the native request has been asked to stop.
  const qualificationRunRef = useRef(0);
  const isPaintingRef = useRef(false);
  const generationRef = useRef<{
    sourceSignature: string;
    userMaskDataUrl: string;
    inferenceMaskDataUrl: string;
    userMaskWidth: number;
    userMaskHeight: number;
    inferenceMaskWidth: number;
    inferenceMaskHeight: number;
    inferenceMaskOffsetX: number;
    inferenceMaskOffsetY: number;
    contextDataUrl: string;
    contextWidth: number;
    contextHeight: number;
    outputFrame: {
      x: number;
      y: number;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
    };
    patchDataUrl: string;
    patchWidth: number;
    patchHeight: number;
    patchFrame?: SourceImageRegion;
    assetKind: 'full-output' | 'region-overlay';
    result: GenerativeEditResult;
    seed: number;
  } | null>(null);
  const sessionSourceSignatureRef = useRef<string | null>(null);
  const variationSequenceRef = useRef(0);
  const maskRevisionRef = useRef(0);
  const currentJobSnapshotRef = useRef<GenerativeJobSnapshot | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourcePreviewImageRef = useRef<Awaited<ReturnType<typeof loadVisibleImageSource>> | null>(
    null,
  );
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);

  const [quality, setQuality] = useState<ContentAwareFillQuality>('fast');
  const [mode, setMode] = useState<GenerativeEditMode>('remove');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | null>(null);
  const [variationCount, setVariationCount] = useState(1);
  const [strength, setStrength] = useState(0.75);
  const [steps, setSteps] = useState(24);
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [imageGuidanceScale, setImageGuidanceScale] = useState(1);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [maskExpansion, setMaskExpansion] = useState(0);
  const [maskFeather, setMaskFeather] = useState(0);
  const [contextPadding, setContextPadding] = useState(32);
  const [maskOrigin, setMaskOrigin] = useState<
    | 'brush'
    | 'pixel-selection'
    | 'layer-mask'
    | 'background-removal'
    | 'image-alpha'
    | 'object-selection'
    | 'persisted'
  >('brush');
  const [maskOperation, setMaskOperation] = useState<MaskCombineOperation>('replace');
  const [modelAvailable, setModelAvailable] = useState(false);
  const [modelFitsMemory, setModelFitsMemory] = useState<boolean | null>(null);
  const [diffusionModelInstalled, setDiffusionModelInstalled] = useState(false);
  const [diffusionModelHandle, setDiffusionModelHandle] = useState<string | null>(null);
  const [diffusionModelSize, setDiffusionModelSize] = useState(0);
  const [diffusionModelReason, setDiffusionModelReason] = useState<string | null>(null);
  const [diffusionResource, setDiffusionResource] = useState<{
    availableBytes: number | null;
    requiredBytes: number;
    tier: string;
    backend: string;
    platform: string;
    architecture: string;
  } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [expandPadding, setExpandPadding] = useState<ExpandPadding>({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const [expandAspectRatio, setExpandAspectRatio] = useState('free');
  const [expandAnchor, setExpandAnchor] = useState<ExpandAnchor>('center');
  const [expandTargetWidth, setExpandTargetWidth] = useState('');
  const [expandTargetHeight, setExpandTargetHeight] = useState('');

  type DialogStatus = 'idle' | 'downloading' | 'qualifying' | 'generating' | 'applying' | 'error';
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerativeEditResult | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [variations, setVariations] = useState<
    Array<{
      id: string;
      dataUrl: string;
      thumbnailDataUrl?: string;
      patchDataUrl: string;
      patchWidth: number;
      patchHeight: number;
      patchFrame?: SourceImageRegion;
      assetKind: 'full-output' | 'region-overlay';
      result: GenerativeEditResult;
      seed: number;
    }>
  >([]);
  const [activeVariationId, setActiveVariationId] = useState<string | null>(null);
  const [hasMaskStrokes, setHasMaskStrokes] = useState(false);
  const [maskRevision, setMaskRevision] = useState(0);
  const [isRefiningMask, setIsRefiningMask] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | 'custom'>('fit');
  const [customZoomBase, setCustomZoomBase] = useState<'fit' | 'natural'>('fit');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [maskVisible, setMaskVisible] = useState(true);
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 });
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('Preparing');
  const isProcessing =
    status === 'downloading' ||
    status === 'qualifying' ||
    status === 'generating' ||
    status === 'applying';
  const hasResult = !isRefiningMask && previewDataUrl != null && result != null;
  const capabilities = getGenerativeEditCapabilities();
  const modeCapability = capabilities.modes[mode];
  const resourceProfile = capabilities.resourceProfile;
  const resourceLabel = [
    resourceProfile.platform,
    resourceProfile.tier === 'unknown' ? null : `${resourceProfile.tier} memory`,
    resourceProfile.architecture,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const promptNeedsDiffusion =
    (mode === 'replace' || mode === 'expand' || mode === 'fill') && prompt.trim().length > 0;
  const usesDiffusion = mode === 'replace' || promptNeedsDiffusion;
  const modeMissingModel =
    (!usesDiffusion && quality === 'ai' && (!modelAvailable || modelFitsMemory === false)) ||
    (usesDiffusion && !diffusionModelHandle);
  const diffusionMemoryFits =
    !usesDiffusion ||
    !diffusionResource ||
    diffusionResource.availableBytes == null ||
    diffusionResource.availableBytes >= diffusionResource.requiredBytes;
  const hasExpandPadding = Object.values(expandPadding).some((value) => value > 0);
  const expandPlanPreview = useMemo(() => {
    if (mode !== 'expand' || naturalSize.w <= 0 || naturalSize.h <= 0) return null;
    return computeExpandPlan(naturalSize.w, naturalSize.h, expandPadding, {
      maxOutputPixels: 16_777_216,
    });
  }, [mode, naturalSize.w, naturalSize.h, expandPadding]);
  const expandWorkingPlanPreview = useMemo(() => {
    if (mode !== 'expand' || !expandPlanPreview?.ok) return null;
    try {
      return {
        ok: true as const,
        plan: planExpandWorkingFrame(
          expandPlanPreview.plan,
          workingPixelBudgetForTier(capabilities.resourceProfile.tier),
        ),
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : 'The expansion working frame is invalid.',
      };
    }
  }, [capabilities.resourceProfile.tier, expandPlanPreview, mode]);
  const modeAvailable =
    modeCapability.available &&
    !modeMissingModel &&
    diffusionMemoryFits &&
    (mode !== 'expand' ||
      (expandPlanPreview?.ok === true && expandWorkingPlanPreview?.ok === true));
  const canGenerate =
    (hasMaskStrokes || (mode === 'expand' && hasExpandPadding)) &&
    (mode !== 'replace' || prompt.trim().length > 0) &&
    (mode !== 'expand' || modeAvailable);
  const modeUnavailableReason =
    mode === 'expand' && expandWorkingPlanPreview && !expandWorkingPlanPreview.ok
      ? expandWorkingPlanPreview.message
      : mode === 'expand' && expandPlanPreview && !expandPlanPreview.ok
        ? expandPlanPreview.error.message
        : (modeCapability.reason ?? null);

  const node = nodeId ? state.document.nodes[nodeId] : undefined;
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';
  const areaSelection = state.areaSelection;
  const layerMaskAsset = typedNode ? resolveRasterMaskAsset(state.document, typedNode) : null;
  const objectSelection =
    typedNode &&
    state.objectSelectionSession?.nodeId === typedNode.id &&
    (!state.objectSelectionSession.documentId ||
      state.objectSelectionSession.documentId === state.document.id)
      ? state.objectSelectionSession
      : null;

  const sourceSignature = typedNode
    ? JSON.stringify({
        src: imageSrc,
        assetId: typedNode.fills?.find((fill) => fill.type === 'image')?.image?.assetId,
        imagePlacement: typedNode.fills?.find((fill) => fill.type === 'image')?.image,
        overlays: (typedNode.fills ?? []).flatMap((fill) => {
          if (fill.type !== 'image' || !fill.image?.generativeEditOverlay) return [];
          const image = fill.image;
          const overlay = image.generativeEditOverlay;
          if (!overlay) return [];
          return [
            {
              assetId: image.assetId ?? null,
              editId: overlay.editId,
              variationId: overlay.variationId,
              x: image.x,
              y: image.y,
              imageWidth: image.imageWidth,
              imageHeight: image.imageHeight,
              scale: image.scale,
              sourceFrame: overlay.sourceFrame ?? null,
            },
          ];
        }),
        shape: typedNode.shape,
        transform: typedNode.transform,
      })
    : '';
  const sourceImage = typedNode?.fills?.find((fill) => fill.type === 'image')?.image;
  const backgroundRemovalPreview =
    typedNode &&
    state.backgroundRemovalPreviewSession?.nodeId === typedNode.id &&
    state.backgroundRemovalPreviewSession.documentId === state.document.id &&
    state.backgroundRemovalPreviewSession.sourceLocator === imageSrc &&
    computePlacementRevision(sourceImage ?? null) ===
      state.backgroundRemovalPreviewSession.placementRevision &&
    (!state.backgroundRemovalPreviewSession.sourceIdentity ||
      state.backgroundRemovalPreviewSession.sourceIdentity.image === sourceImage)
      ? state.backgroundRemovalPreviewSession
      : null;
  const acceptedEdit = typedNode?.generativeEditId
    ? state.document.generativeEdits?.[typedNode.generativeEditId]
    : undefined;
  const acceptedVariation = acceptedEdit
    ? (acceptedEdit.variations.find(
        (variation) =>
          variation.id === (acceptedEdit.acceptedVariationId ?? acceptedEdit.activeVariationId),
      ) ?? acceptedEdit.variations[0])
    : undefined;
  const acceptedResultAsset = acceptedVariation?.assetId
    ? state.document.assets?.[acceptedVariation.assetId]
    : undefined;
  const acceptedSourceAsset = acceptedEdit?.sourceSnapshotAssetId
    ? state.document.assets?.[acceptedEdit.sourceSnapshotAssetId]
    : acceptedEdit?.sourceAssetId
      ? state.document.assets?.[acceptedEdit.sourceAssetId]
      : undefined;
  const acceptedUserMaskAsset = acceptedEdit?.masks.userMaskAssetId
    ? state.document.rasterMaskAssets?.[acceptedEdit.masks.userMaskAssetId]
    : undefined;
  const acceptedInferenceMaskAsset = acceptedEdit?.masks.inferenceMaskAssetId
    ? state.document.rasterMaskAssets?.[acceptedEdit.masks.inferenceMaskAssetId]
    : undefined;
  const acceptedContextAsset = acceptedVariation?.contextAssetId
    ? state.document.assets?.[acceptedVariation.contextAssetId]
    : undefined;
  const sourceAssetId = sourceImage?.assetId ?? null;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;
  const overlaySources = useMemo(
    () => visibleSourceOverlays(typedNode, state.document.assets),
    [state.document.assets, typedNode?.fills],
  );
  const sourceHash = sourceAssetId
    ? (state.document.assets?.[sourceAssetId]?.hash ?? hashContent(imageSrc))
    : hashContent(imageSrc);
  // The editor revision changes for unrelated document edits too. Use the
  // source fingerprint for the job's source revision so an unrelated layer
  // edit does not invalidate a valid generation; sourceHash/placement still
  // guard the actual image and its mapping independently.
  const sourceRevision = Number.parseInt(sourceHash.slice(0, 8), 16) || 0;
  const settingsFingerprint = JSON.stringify({
    mode,
    quality,
    prompt,
    negativePrompt,
    seed,
    variationCount,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    maskExpansion,
    maskFeather,
    contextPadding,
  });
  currentJobSnapshotRef.current = typedNode
    ? {
        documentId: state.document.id,
        targetId: nodeId ?? '',
        sourceRevision,
        sourceAssetId,
        sourceHash,
        placementFingerprint: sourceSignature,
        maskRevision,
        settingsFingerprint,
        outputFrameFingerprint: JSON.stringify(mode === 'expand' ? expandPadding : null),
      }
    : null;

  const invalidatePreview = useCallback(() => {
    jobControllerRef.current.cancel();
    generationRef.current = null;
    setResult(null);
    setPreviewDataUrl(null);
    setVariations([]);
    setActiveVariationId(null);
    setStatus('idle');
  }, []);

  // Expand temporarily resizes the review canvas to the proposed output frame.
  // Returning to a bounded mode must restore the source-sized canvas, or the
  // next review would composite onto the expanded frame dimensions.
  const resetPreviewToSource = useCallback(() => {
    const image = sourcePreviewImageRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!image || !previewCanvas || naturalSize.w <= 0 || naturalSize.h <= 0) return;
    const preview = previewRasterDimensions(naturalSize.w, naturalSize.h);
    previewCanvas.width = preview.width;
    previewCanvas.height = preview.height;
    const context = previewCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(image, 0, 0, preview.width, preview.height);
  }, [naturalSize.w, naturalSize.h]);

  const handleEditMask = useCallback(() => {
    jobControllerRef.current.cancel();
    generationRef.current = null;
    setIsRefiningMask(true);
    setResult(null);
    setPreviewDataUrl(null);
    setActiveVariationId(null);
    setShowOriginal(false);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const bumpMaskRevision = useCallback(() => {
    const nextRevision = maskRevisionRef.current + 1;
    maskRevisionRef.current = nextRevision;
    setMaskRevision(nextRevision);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const area = previewAreaRef.current;
    if (!area) return;
    const measure = () =>
      setPreviewViewport({ width: area.clientWidth, height: area.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(area);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen && !el.open) {
      el.showModal();
    } else if (!isOpen && el.open) {
      el.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    jobControllerRef.current.cancel();
    qualificationRunRef.current += 1;
    sessionSourceSignatureRef.current = sourceSignature;
    setQuality('fast');
    setMode('remove');
    setPrompt('');
    setNegativePrompt('');
    setSeed(null);
    setVariationCount(1);
    setStrength(0.75);
    setSteps(24);
    setGuidanceScale(7);
    setImageGuidanceScale(1);
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setMaskExpansion(0);
    setMaskFeather(0);
    setContextPadding(32);
    setMaskOrigin('brush');
    setMaskOperation('replace');
    maskRevisionRef.current = 0;
    setMaskRevision(0);
    setModelAvailable(false);
    setModelFitsMemory(null);
    setDiffusionModelInstalled(false);
    setDiffusionModelHandle(null);
    setDiffusionModelSize(0);
    setDiffusionModelReason(null);
    setStatus('idle');
    setErrorMessage(null);
    setResult(null);
    setPreviewDataUrl(null);
    setVariations([]);
    setActiveVariationId(null);
    generationRef.current = null;
    setHasMaskStrokes(false);
    setIsRefiningMask(false);
    setShowOriginal(false);
    setPreviewZoom('fit');
    setCustomZoomBase('fit');
    setZoomPercent(100);
    setMaskVisible(true);
    setDownloadProgress(0);
    setGenerationProgress(0);
    setGenerationStage('Preparing');
    setNaturalSize({ w: 0, h: 0 });
    setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    setExpandAspectRatio('free');
    setExpandAnchor('center');
    setExpandTargetWidth('');
    setExpandTargetHeight('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !acceptedEdit) return;
    const settings = acceptedEdit.settings;
    setMode(acceptedEdit.mode);
    setQuality(settings.quality === 'draft' ? 'fast' : 'ai');
    setPrompt(settings.prompt ?? '');
    setNegativePrompt(settings.negativePrompt ?? '');
    setSeed(settings.seed ?? null);
    setStrength(settings.strength ?? 0.75);
    setSteps(settings.steps ?? 24);
    setGuidanceScale(settings.guidanceScale ?? 7);
    setImageGuidanceScale(settings.imageGuidanceScale ?? 1);
    setMaskExpansion(settings.maskExpansion ?? 0);
    setMaskFeather(settings.feather ?? 0);
    setContextPadding(settings.contextPadding ?? 32);
    if (acceptedEdit.mode === 'expand') {
      setExpandPadding({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
      setExpandAspectRatio('free');
      setExpandAnchor('center');
      // Reopening an accepted Expand reviews the accepted output, which is
      // now the current source for a possible subsequent expansion. Reusing
      // the original margins here would silently plan the same expansion a
      // second time against an already-expanded frame.
      setExpandTargetWidth(String(acceptedEdit.outputFrame.width));
      setExpandTargetHeight(String(acceptedEdit.outputFrame.height));
    }
    setVariationCount(
      Math.max(1, Math.min(MAX_BATCH_VARIATIONS, acceptedEdit.variations.length || 1)),
    );
  }, [acceptedEdit, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!typedNode || !imageSrc) {
      invalidatePreview();
      announce('Generative Edit closed because its source image is no longer available');
      onClose();
      return;
    }
    const previous = sessionSourceSignatureRef.current;
    if (previous && previous !== sourceSignature) {
      invalidatePreview();
      setErrorMessage('The source image changed. Review the mask and generate again.');
      sessionSourceSignatureRef.current = sourceSignature;
    }
  }, [announce, imageSrc, invalidatePreview, isOpen, onClose, sourceSignature, typedNode]);

  useEffect(() => {
    if (!isOpen) {
      jobControllerRef.current.cancel();
      downloadAbortRef.current?.abort();
      diffusionDownloadAbortRef.current?.abort();
      qualificationAbortRef.current?.abort();
      qualificationRunRef.current += 1;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      jobControllerRef.current.cancel();
      downloadAbortRef.current?.abort();
      diffusionDownloadAbortRef.current?.abort();
      qualificationAbortRef.current?.abort();
      qualificationRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const isNative = capabilities.resourceProfile.executionBackend === 'native';
      const [available, fitsMemory] = await Promise.all([
        loader.isModelAvailable(MODEL_ID),
        isNative ? Promise.resolve(true) : isWasmModelSafe(MODEL_ID),
      ]);
      if (!cancelled) {
        setModelAvailable(available);
        setModelFitsMemory(fitsMemory);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capabilities.resourceProfile.executionBackend, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void getNativeGenerativeModelStatus().then((available) => {
      if (cancelled) return;
      setDiffusionModelInstalled(available.installed);
      setDiffusionModelHandle(available.ready ? available.modelHandle : null);
      setDiffusionModelSize(available.sizeBytes);
      setDiffusionModelReason(available.reason);
      setDiffusionResource({
        availableBytes: available.memoryAvailableBytes ?? null,
        requiredBytes:
          available.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: available.resourceTier ?? 'unknown',
        backend: available.executionBackend ?? 'unknown',
        platform: available.platform ?? 'unknown',
        architecture: available.architecture ?? 'unknown',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const knownWidth =
          sourceImage?.imageWidth ??
          sourceAsset?.naturalWidth ??
          acceptedSourceAsset?.naturalWidth ??
          0;
        const knownHeight =
          sourceImage?.imageHeight ??
          sourceAsset?.naturalHeight ??
          acceptedSourceAsset?.naturalHeight ??
          0;
        const previewHint =
          knownWidth > 0 && knownHeight > 0
            ? previewRasterDimensions(knownWidth, knownHeight)
            : { width: 1024, height: 1024 };
        // Bounded edits rebuild the review baseline from the immutable source
        // plus accepted overlay patches. Expand replaces the source fill with
        // a full output, so reopening or expanding again must start from that
        // current accepted frame instead of reverting to the old snapshot.
        const baseSource =
          acceptedEdit?.mode === 'expand'
            ? (sourceAsset?.dataUrl ?? imageSrc ?? acceptedSourceAsset?.dataUrl ?? '')
            : (acceptedSourceAsset?.dataUrl ?? sourceAsset?.dataUrl ?? imageSrc);
        const reviewOverlays = overlaySources.filter(
          (overlay) => overlay.editId !== acceptedEdit?.id,
        );
        const img = await loadVisibleImageSource(
          baseSource,
          knownWidth,
          knownHeight,
          Math.max(previewHint.width, previewHint.height),
          reviewOverlays,
        );
        if (cancelled) return;
        sourcePreviewImageRef.current = img;

        const decoded = imageSourceDims(img);
        const nw = knownWidth || decoded.width;
        const nh = knownHeight || decoded.height;
        if (nw <= 0 || nh <= 0) throw new Error('Image dimensions are unavailable');
        const preview = previewRasterDimensions(nw, nh);
        setNaturalSize({ w: nw, h: nh });

        const previewCanvas = previewCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (previewCanvas) {
          previewCanvas.width = preview.width;
          previewCanvas.height = preview.height;
          const ctx = previewCanvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, preview.width, preview.height);
        }
        if (maskCanvas) {
          maskCanvas.width = preview.width;
          maskCanvas.height = preview.height;
          const mctx = maskCanvas.getContext('2d');
          if (mctx) {
            mctx.fillStyle = 'black';
            mctx.fillRect(0, 0, preview.width, preview.height);
          }
        }
        setHasMaskStrokes(false);

        if (acceptedUserMaskAsset?.dataUrl && maskCanvas) {
          // Persisted masks can be source-resolution masks from large photos.
          // Decode them directly into the bounded preview rather than routing
          // them through the interactive mask limit used for new selections.
          const decoded = await loadImageToImageData(
            acceptedUserMaskAsset.dataUrl,
            preview.width,
            preview.height,
          );
          if (cancelled) return;
          const coverage = maskCoverageFromRgba(decoded.data);
          const maskContext = maskCanvas.getContext('2d');
          if (maskContext) {
            putMaskCoverage(maskContext, coverage, {
              width: preview.width,
              height: preview.height,
            });
            setHasMaskStrokes(coverage.some((value) => value > 0));
            setMaskOrigin('persisted');
            maskRevisionRef.current = 1;
            setMaskRevision(1);
          }
        }

        if (acceptedEdit && acceptedVariation && acceptedResultAsset?.dataUrl) {
          if (cancelled) return;
          if (!previewCanvas) throw new Error('Preview canvas is unavailable');
          const restoredVariations = (
            await Promise.all(
              acceptedEdit.variations.map(async (variation) => {
                const asset = variation.assetId
                  ? state.document.assets?.[variation.assetId]
                  : undefined;
                const thumbnail = variation.thumbnailAssetId
                  ? state.document.assets?.[variation.thumbnailAssetId]
                  : undefined;
                if (!asset?.dataUrl) return null;
                const assetKind = variation.assetKind ?? 'full-output';
                const dataUrl = await persistedVariationPreviewDataUrl(
                  previewCanvas,
                  nw,
                  nh,
                  variation,
                  asset,
                );
                return {
                  id: variation.id,
                  dataUrl,
                  thumbnailDataUrl: thumbnail?.dataUrl,
                  patchDataUrl: asset.dataUrl,
                  patchWidth: asset.naturalWidth,
                  patchHeight: asset.naturalHeight,
                  patchFrame:
                    assetKind === 'region-overlay' && variation.outputFrame
                      ? {
                          x: variation.outputFrame.x,
                          y: variation.outputFrame.y,
                          width: variation.outputFrame.width,
                          height: variation.outputFrame.height,
                        }
                      : undefined,
                  assetKind,
                  result: persistedVariationResult(
                    acceptedEdit,
                    variation,
                    unloadedVariationImageData(),
                  ),
                  seed:
                    variation.seed ?? variation.settings?.seed ?? acceptedEdit.settings.seed ?? 0,
                };
              }),
            )
          ).filter((variation): variation is NonNullable<typeof variation> => variation !== null);
          const restoredResult =
            restoredVariations.find((variation) => variation.id === acceptedVariation.id)?.result ??
            persistedVariationResult(acceptedEdit, acceptedVariation, unloadedVariationImageData());
          const restoredActive =
            restoredVariations.find((variation) => variation.id === acceptedVariation.id) ??
            restoredVariations[0];
          // The session's output frame describes the accepted node bounds. A
          // region-overlay variation carries its bounded patch frame on the
          // variation itself and must not replace this source frame.
          const restoredOutputFrame = acceptedEdit.outputFrame;
          const inferenceMaskWidth = acceptedEdit.masks.width;
          const inferenceMaskHeight = acceptedEdit.masks.height;
          const context = acceptedContextAsset;
          generationRef.current = {
            sourceSignature,
            userMaskDataUrl: acceptedUserMaskAsset?.dataUrl ?? '',
            inferenceMaskDataUrl: acceptedInferenceMaskAsset?.dataUrl ?? '',
            userMaskWidth: acceptedEdit.masks.userWidth ?? acceptedEdit.maskWidth,
            userMaskHeight: acceptedEdit.masks.userHeight ?? acceptedEdit.maskHeight,
            inferenceMaskWidth,
            inferenceMaskHeight,
            inferenceMaskOffsetX: acceptedEdit.masks.offsetX,
            inferenceMaskOffsetY: acceptedEdit.masks.offsetY,
            contextDataUrl: context?.dataUrl ?? '',
            contextWidth: context?.naturalWidth ?? 1,
            contextHeight: context?.naturalHeight ?? 1,
            outputFrame: {
              x: restoredOutputFrame.x,
              y: restoredOutputFrame.y,
              width: restoredOutputFrame.width,
              height: restoredOutputFrame.height,
              sourceWidth: restoredOutputFrame.sourceWidth,
              sourceHeight: restoredOutputFrame.sourceHeight,
            },
            patchDataUrl: restoredActive?.patchDataUrl ?? acceptedResultAsset.dataUrl,
            patchWidth: restoredActive?.patchWidth ?? acceptedResultAsset.naturalWidth,
            patchHeight: restoredActive?.patchHeight ?? acceptedResultAsset.naturalHeight,
            patchFrame: restoredActive?.patchFrame,
            assetKind: restoredActive?.assetKind ?? 'full-output',
            result: restoredResult,
            seed: restoredActive?.seed ?? acceptedVariation.seed ?? acceptedEdit.settings.seed ?? 0,
          };
          setVariations(restoredVariations);
          setActiveVariationId(acceptedVariation.id);
          setResult(restoredResult);
          setPreviewDataUrl(restoredActive?.dataUrl ?? acceptedResultAsset.dataUrl);
          setShowOriginal(false);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    acceptedContextAsset,
    acceptedEdit,
    acceptedInferenceMaskAsset,
    acceptedResultAsset,
    acceptedSourceAsset,
    acceptedUserMaskAsset,
    acceptedVariation,
    imageSrc,
    isOpen,
    overlaySources,
    sourceSignature,
    sourceAsset,
    sourceImage?.imageHeight,
    sourceImage?.imageWidth,
    state.document.assets,
  ]);

  const centerPreview = useCallback(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
    area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(centerPreview);
    return () => cancelAnimationFrame(frame);
  }, [centerPreview, naturalSize, previewZoom, zoomPercent, previewViewport]);

  const previewNaturalWidth = result?.mode === 'expand' ? result.width : naturalSize.w;
  const previewNaturalHeight = result?.mode === 'expand' ? result.height : naturalSize.h;
  const fitScale =
    previewNaturalWidth > 0 &&
    previewNaturalHeight > 0 &&
    previewViewport.width > 0 &&
    previewViewport.height > 0
      ? Math.min(
          previewViewport.width / previewNaturalWidth,
          previewViewport.height / previewNaturalHeight,
        )
      : 1;
  const displayScale =
    previewZoom === 'fit'
      ? fitScale
      : customZoomBase === 'fit'
        ? fitScale * (zoomPercent / 100)
        : zoomPercent / 100;
  const displayWidth =
    previewNaturalWidth > 0 ? Math.max(1, Math.round(previewNaturalWidth * displayScale)) : 0;
  const displayHeight =
    previewNaturalHeight > 0 ? Math.max(1, Math.round(previewNaturalHeight * displayScale)) : 0;

  const selectFitZoom = useCallback(() => {
    setCustomZoomBase('fit');
    setPreviewZoom('fit');
  }, []);

  const selectOneToOneZoom = useCallback(() => {
    setCustomZoomBase('natural');
    setZoomPercent(100);
    setPreviewZoom('custom');
  }, []);

  const adjustZoom = useCallback(
    (delta: number) => {
      if (previewZoom === 'fit') setCustomZoomBase('fit');
      setZoomPercent((current) => Math.max(25, Math.min(400, current + delta)));
      setPreviewZoom('custom');
    },
    [previewZoom],
  );

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const current = maskCoverageFromRgba(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      );
      const incoming = new Uint8Array(current.length);
      const radius = brushSize / 2;
      const minX = Math.max(0, Math.floor(x - radius));
      const maxX = Math.min(canvas.width - 1, Math.ceil(x + radius));
      const minY = Math.max(0, Math.floor(y - radius));
      const maxY = Math.min(canvas.height - 1, Math.ceil(y + radius));
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= radius) {
            incoming[py * canvas.width + px] = 255;
          }
        }
      }
      const combined = combineMaskCoverage(current, incoming, maskOperation);
      putMaskCoverage(ctx, combined, {
        width: canvas.width,
        height: canvas.height,
      });
      if (hasMaskStrokes !== combined.some((value) => value > 0)) {
        setHasMaskStrokes(combined.some((value) => value > 0));
      }
      bumpMaskRevision();
    },
    [brushSize, bumpMaskRevision, hasMaskStrokes, maskOperation],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isProcessing) return;
      isPaintingRef.current = true;
      setMaskOrigin('brush');
      e.currentTarget.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [isProcessing, paintAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isPaintingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleClearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasMaskStrokes(false);
    setMaskOrigin('brush');
    bumpMaskRevision();
    invalidatePreview();
  }, [bumpMaskRevision, invalidatePreview]);

  const applyMaskCoverage = useCallback(
    (
      coverage: Uint8Array,
      width: number,
      height: number,
      origin:
        | 'pixel-selection'
        | 'layer-mask'
        | 'background-removal'
        | 'image-alpha'
        | 'object-selection',
    ): boolean => {
      const canvas = maskCanvasRef.current;
      if (!canvas || naturalSize.w <= 0 || naturalSize.h <= 0) {
        announce('The source image is still loading; try again in a moment');
        return false;
      }
      try {
        const resized = resizeMaskCoverage(
          coverage,
          { width, height },
          { width: canvas.width, height: canvas.height },
        );
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Mask canvas unavailable');
        const current = maskCoverageFromRgba(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        );
        const combined = combineMaskCoverage(current, resized, maskOperation);
        putMaskCoverage(context, combined, { width: canvas.width, height: canvas.height });
        setHasMaskStrokes(combined.some((value) => value > 0));
        setMaskOrigin(origin);
        bumpMaskRevision();
        invalidatePreview();
        setErrorMessage(null);
        return true;
      } catch (err) {
        announce(err instanceof Error ? err.message : 'The mask could not be loaded');
        return false;
      }
    },
    [announce, bumpMaskRevision, invalidatePreview, maskOperation, naturalSize.h, naturalSize.w],
  );

  const handleUsePixelSelection = useCallback(() => {
    if (!nodeId || !areaSelection) {
      announce('Create a pixel selection before using it as the edit mask');
      return;
    }
    const raster = rasterizeAreaSelectionForNode(state.document, nodeId, areaSelection);
    if (!raster) {
      announce('The current pixel selection cannot be mapped to this image');
      return;
    }
    applyMaskCoverage(raster.data, raster.width, raster.height, 'pixel-selection');
  }, [announce, applyMaskCoverage, areaSelection, nodeId, state.document]);

  const handleUseObjectSelection = useCallback(() => {
    if (objectSelection?.status !== 'ready') {
      announce('Run Object Selection and choose a candidate before using it as the edit mask');
      return;
    }
    const candidate = objectSelection.candidates[objectSelection.selectedCandidate];
    if (!candidate || objectSelection.width <= 0 || objectSelection.height <= 0) {
      announce('The selected Object Selection candidate is not available');
      return;
    }
    applyMaskCoverage(
      candidate.mask,
      objectSelection.width,
      objectSelection.height,
      'object-selection',
    );
  }, [announce, applyMaskCoverage, objectSelection]);

  const handleStartObjectSelection = useCallback(() => {
    if (!nodeId) {
      announce('Select one image before starting Object Selection');
      return;
    }
    if (hasMaskStrokes) {
      announce(
        'Finish or clear the current mask before leaving Generative Edit for Object Selection; the in-progress mask is not discarded.',
      );
      return;
    }
    // The dialog is modal, so the canvas cannot receive the click/box prompt
    // while it is open. Close this review session first, then hand control to
    // the canonical Object Selection tool. The transient candidate remains
    // attached to this image and can be imported when Generative Edit is
    // opened again.
    onClose();
    setTool('sam2Segment');
    announce(
      'Object Selection active. Click to include, Shift-click to subtract, or drag a box; reopen Generative Edit to use the candidate.',
    );
  }, [announce, hasMaskStrokes, nodeId, onClose, setTool]);

  const handleUseLayerMask = useCallback(async () => {
    if (!layerMaskAsset) {
      announce('This image has no raster layer mask to use');
      return;
    }
    const target = maskCanvasRef.current;
    if (!target || naturalSize.w <= 0 || naturalSize.h <= 0) {
      announce('The source image is still loading; try again in a moment');
      return;
    }
    const decoded = await decodeRasterMaskDataUrl(layerMaskAsset.dataUrl, {
      width: target.width,
      height: target.height,
    });
    if (!decoded) {
      announce('The layer mask could not be decoded');
      return;
    }
    if (
      (decoded.sourceWidth ?? decoded.width) !== layerMaskAsset.width ||
      (decoded.sourceHeight ?? decoded.height) !== layerMaskAsset.height
    ) {
      announce('The layer mask dimensions do not match the stored mask asset');
      return;
    }
    applyMaskCoverage(
      maskCoverageFromRgba(decoded.data),
      decoded.width,
      decoded.height,
      'layer-mask',
    );
  }, [announce, applyMaskCoverage, layerMaskAsset, naturalSize.h, naturalSize.w]);

  const handleUseBackgroundRemovalPreview = useCallback(async () => {
    if (!backgroundRemovalPreview) {
      announce('The background removal preview is no longer current; run it again first');
      return;
    }
    const target = maskCanvasRef.current;
    if (!target || naturalSize.w <= 0 || naturalSize.h <= 0) {
      announce('The source image is still loading; try again in a moment');
      return;
    }
    const decoded = await decodeRasterMaskDataUrl(backgroundRemovalPreview.maskDataUrl, {
      width: target.width,
      height: target.height,
    });
    if (!decoded) {
      announce('The background removal preview mask could not be decoded');
      return;
    }
    const expectedSourceWidth =
      naturalSize.w || sourceImage?.imageWidth || sourceAsset?.naturalWidth || 0;
    const expectedSourceHeight =
      naturalSize.h || sourceImage?.imageHeight || sourceAsset?.naturalHeight || 0;
    if (
      (decoded.sourceWidth ?? decoded.width) !== backgroundRemovalPreview.width ||
      (decoded.sourceHeight ?? decoded.height) !== backgroundRemovalPreview.height ||
      backgroundRemovalPreview.sourceWidth !== expectedSourceWidth ||
      backgroundRemovalPreview.sourceHeight !== expectedSourceHeight
    ) {
      announce('The background removal preview does not match the current source dimensions');
      return;
    }
    const applied = applyMaskCoverage(
      maskCoverageFromRgba(decoded.data),
      decoded.width,
      decoded.height,
      'background-removal',
    );
    if (applied) {
      announce(
        `Using the ${backgroundRemovalPreview.actualMethod} background removal preview as an editable mask`,
      );
    }
  }, [
    announce,
    applyMaskCoverage,
    backgroundRemovalPreview,
    naturalSize.h,
    naturalSize.w,
    sourceAsset?.naturalHeight,
    sourceAsset?.naturalWidth,
    sourceImage?.imageHeight,
    sourceImage?.imageWidth,
  ]);

  const handleUseImageAlpha = useCallback(async () => {
    if (!imageSrc) {
      announce('The source image is not available for alpha selection');
      return;
    }
    try {
      const preview = previewRasterDimensions(naturalSize.w, naturalSize.h);
      const imageData = await loadImageToImageData(imageSrc, preview.width, preview.height);
      const coverage = new Uint8Array(imageData.width * imageData.height);
      for (let index = 0; index < coverage.length; index += 1) {
        coverage[index] = imageData.data[index * 4 + 3]!;
      }
      applyMaskCoverage(coverage, imageData.width, imageData.height, 'image-alpha');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'The image alpha could not be loaded');
    }
  }, [announce, applyMaskCoverage, imageSrc]);

  const handleInvertMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !hasMaskStrokes) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const coverage = maskCoverageFromRgba(imageData.data);
    for (let i = 0; i < coverage.length; i += 1) coverage[i] = 255 - coverage[i]!;
    putMaskCoverage(context, coverage, { width: canvas.width, height: canvas.height });
    setHasMaskStrokes(coverage.some((value) => value > 0));
    bumpMaskRevision();
    invalidatePreview();
  }, [bumpMaskRevision, hasMaskStrokes, invalidatePreview]);

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setModelAvailable(true);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Download failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, []);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
    diffusionDownloadAbortRef.current?.abort();
  }, []);

  const handleCancelQualification = useCallback(() => {
    qualificationAbortRef.current?.abort();
    qualificationAbortRef.current = null;
    qualificationRunRef.current += 1;
    setStatus('idle');
  }, []);

  const handleDownloadDiffusionModel = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    diffusionDownloadAbortRef.current = controller;
    try {
      const downloaded = await downloadNativeGenerativeModel(({ loaded, total }) => {
        setDownloadProgress(
          total > 0
            ? Math.round((loaded / total) * 100)
            : Math.round((loaded / NATIVE_GENERATIVE_MODEL_PROFILE.sizeBytes) * 100),
        );
      }, controller.signal);
      setDiffusionModelInstalled(downloaded.installed);
      setDiffusionModelHandle(downloaded.ready ? downloaded.modelHandle : null);
      setDiffusionModelSize(downloaded.sizeBytes);
      setDiffusionModelReason(downloaded.reason);
      setDiffusionResource({
        availableBytes: downloaded.memoryAvailableBytes ?? null,
        requiredBytes:
          downloaded.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: downloaded.resourceTier ?? 'unknown',
        backend: downloaded.executionBackend ?? 'unknown',
        platform: downloaded.platform ?? 'unknown',
        architecture: downloaded.architecture ?? 'unknown',
      });
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be downloaded.',
      );
    } finally {
      diffusionDownloadAbortRef.current = null;
    }
  }, []);

  const handleImportDiffusionModel = useCallback(async () => {
    try {
      const tauri = (
        window as Window & {
          __TAURI__?: {
            core?: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
          };
        }
      ).__TAURI__;
      if (!tauri?.core?.invoke) {
        throw new Error('Model installation is available in the desktop app only.');
      }
      const picked = (await tauri.core.invoke('plugin:dialog|open', {
        options: {
          multiple: false,
          filters: [{ name: 'Diffusion model', extensions: ['safetensors', 'gguf'] }],
        },
      })) as Array<{ path?: string }> | null;
      const selected = picked?.[0]?.path;
      if (!selected) return;
      const imported = await importNativeGenerativeModel(selected);
      setDiffusionModelInstalled(imported.installed);
      setDiffusionModelHandle(imported.ready ? imported.modelHandle : null);
      setDiffusionModelSize(imported.sizeBytes);
      setDiffusionModelReason(imported.reason);
      setDiffusionResource({
        availableBytes: imported.memoryAvailableBytes ?? null,
        requiredBytes:
          imported.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: imported.resourceTier ?? 'unknown',
        backend: imported.executionBackend ?? 'unknown',
        platform: imported.platform ?? 'unknown',
        architecture: imported.architecture ?? 'unknown',
      });
      setErrorMessage(null);
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be installed.',
      );
    }
  }, []);

  const handleQualifyDiffusionModel = useCallback(async () => {
    const runId = qualificationRunRef.current + 1;
    qualificationRunRef.current = runId;
    const isCurrentQualification = () => qualificationRunRef.current === runId;
    const controller = new AbortController();
    qualificationAbortRef.current?.abort();
    qualificationAbortRef.current = controller;
    setStatus('qualifying');
    setErrorMessage(null);
    try {
      const qualified = await qualifyNativeGenerativeModel(controller.signal);
      if (!isCurrentQualification()) return;
      setDiffusionModelInstalled(qualified.installed);
      setDiffusionModelHandle(qualified.ready ? qualified.modelHandle : null);
      setDiffusionModelSize(qualified.sizeBytes);
      setDiffusionModelReason(qualified.reason);
      setDiffusionResource({
        availableBytes: qualified.memoryAvailableBytes ?? null,
        requiredBytes:
          qualified.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: qualified.resourceTier ?? 'unknown',
        backend: qualified.executionBackend ?? 'unknown',
        platform: qualified.platform ?? 'unknown',
        architecture: qualified.architecture ?? 'unknown',
      });
      if (!qualified.ready) throw new Error(qualified.reason ?? 'Model qualification failed.');
      setStatus('idle');
    } catch (err) {
      if (!isCurrentQualification()) return;
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be qualified.',
      );
    } finally {
      if (qualificationAbortRef.current === controller) qualificationAbortRef.current = null;
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!imageSrc || !modeAvailable || !canGenerate) return;
    const jobSnapshot = currentJobSnapshotRef.current;
    if (!jobSnapshot) return;
    const token = jobControllerRef.current.start(jobSnapshot);
    const isCurrentJob = () => {
      const currentSnapshot = currentJobSnapshotRef.current;
      const candidate = currentSnapshot
        ? { ...currentSnapshot, maskRevision: maskRevisionRef.current }
        : null;
      const current = candidate ? jobControllerRef.current.isCurrent(token, candidate) : false;
      return current;
    };
    setStatus('generating');
    setErrorMessage(null);
    setGenerationProgress(0);
    setGenerationStage('Preparing');

    try {
      const sourceWidth =
        naturalSize.w || sourceImage?.imageWidth || sourceAsset?.naturalWidth || 0;
      const sourceHeight =
        naturalSize.h || sourceImage?.imageHeight || sourceAsset?.naturalHeight || 0;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        throw new GenerativeEditError(
          'invalid-image',
          'The source image dimensions are unavailable.',
        );
      }
      if (!isCurrentJob()) {
        throw new GenerativeEditError('stale', 'The source changed before generation completed.');
      }

      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');

      const previewMaskImageData = maskCanvas
        .getContext('2d')
        ?.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      if (!previewMaskImageData)
        throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');
      const previewMask = maskCoverageFromRgba(previewMaskImageData.data);
      const previewWidth = maskCanvas.width;
      const previewHeight = maskCanvas.height;
      if (previewWidth <= 0 || previewHeight <= 0) {
        throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');
      }

      let generationImage: ImageData;
      let mask: Uint8Array;
      let maskWidth: number;
      let maskHeight: number;
      let sourceRegion: SourceImageRegion | null = null;
      let userMaskDataUrl: string;
      let outputFrame: {
        x: number;
        y: number;
        width: number;
        height: number;
        sourceWidth: number;
        sourceHeight: number;
      };
      let expandContext: {
        fullPlan: ExpandPlan;
        working: ExpandWorkingFrame;
        sourceBase: string;
      } | null = null;

      if (mode === 'expand') {
        const planned = computeExpandPlan(sourceWidth, sourceHeight, expandPadding, {
          maxOutputPixels: 16_777_216,
        });
        if (!planned.ok) {
          throw new GenerativeEditError(
            planned.error.code === 'invalid-margin' ? 'invalid-mask' : 'insufficient-memory',
            planned.error.message,
          );
        }
        const fullPlan = planned.plan;
        const workingBudget = workingPixelBudgetForTier(capabilities.resourceProfile.tier);
        const working = planExpandWorkingFrame(fullPlan, workingBudget);
        const sourceBase = sourceAsset?.dataUrl ?? acceptedSourceAsset?.dataUrl ?? imageSrc;
        const visibleSource = await loadVisibleImageSource(
          sourceBase,
          sourceWidth,
          sourceHeight,
          Math.max(working.sourceWidth, working.sourceHeight),
          overlaySources,
        );
        const visibleDimensions = imageSourceDims(visibleSource);
        if (visibleDimensions.width <= 0 || visibleDimensions.height <= 0) {
          throw new GenerativeEditError('invalid-image', 'The source image could not be decoded.');
        }
        const sourceRaster = loadImageRegionToImageData(
          visibleSource,
          { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
          { width: working.sourceWidth, height: working.sourceHeight },
        );
        const expanded = buildExpandedFrame(sourceRaster, working.plan);
        generationImage = expanded.imageData;
        mask = expanded.mask;
        maskWidth = expanded.width;
        maskHeight = expanded.height;
        userMaskDataUrl = maskCoverageDataUrl(mask, maskWidth, maskHeight);
        expandContext = { fullPlan, working, sourceBase };
        const originalPreview = previewCanvasRef.current;
        if (originalPreview) {
          const previewDimensions = previewRasterDimensions(
            fullPlan.outputWidth,
            fullPlan.outputHeight,
          );
          originalPreview.width = previewDimensions.width;
          originalPreview.height = previewDimensions.height;
          const previewContext = originalPreview.getContext('2d');
          if (!previewContext) throw new Error('Preview canvas is unavailable');
          previewContext.clearRect(0, 0, originalPreview.width, originalPreview.height);
          previewContext.imageSmoothingEnabled = true;
          previewContext.imageSmoothingQuality = 'high';
          previewContext.drawImage(
            visibleSource,
            0,
            0,
            visibleDimensions.width,
            visibleDimensions.height,
            (fullPlan.sourceOffsetX / fullPlan.outputWidth) * originalPreview.width,
            (fullPlan.sourceOffsetY / fullPlan.outputHeight) * originalPreview.height,
            (fullPlan.sourceWidth / fullPlan.outputWidth) * originalPreview.width,
            (fullPlan.sourceHeight / fullPlan.outputHeight) * originalPreview.height,
          );
        }
        outputFrame = expandPlanOutputFrame(fullPlan);
      } else {
        const rawBounds = computeSourceRegionFromPreviewMask(
          previewMask,
          previewWidth,
          previewHeight,
          sourceWidth,
          sourceHeight,
          contextPadding,
        );
        if (!rawBounds) {
          throw new GenerativeEditError('empty-mask', 'Paint an area to edit before generating.');
        }
        const previewScaleX = previewWidth / sourceWidth;
        const previewScaleY = previewHeight / sourceHeight;
        const refinedPreviewMask = refineGenerativeMask(
          previewMask,
          { width: previewWidth, height: previewHeight },
          {
            expansion: Math.round(maskExpansion * previewScaleX),
            feather: Math.round(maskFeather * Math.min(previewScaleX, previewScaleY)),
          },
        );
        const region = computeSourceRegionFromPreviewMask(
          refinedPreviewMask,
          previewWidth,
          previewHeight,
          sourceWidth,
          sourceHeight,
          contextPadding,
        );
        if (!region) {
          throw new GenerativeEditError('empty-mask', 'Mask refinement removed the edit region.');
        }
        const working = workingRasterDimensions(
          region,
          workingPixelBudgetForTier(capabilities.resourceProfile.tier),
        );
        const sourceBase = sourceAsset?.dataUrl ?? acceptedSourceAsset?.dataUrl ?? imageSrc;
        const sourceProxy = await loadVisibleImageSource(
          sourceBase,
          sourceWidth,
          sourceHeight,
          MAX_SOURCE_PROXY_DIMENSION,
          overlaySources,
        );
        const proxyDimensions = imageSourceDims(sourceProxy);
        const proxyRegion = mapSourceRegionToProxy(
          region,
          sourceWidth,
          sourceHeight,
          proxyDimensions.width,
          proxyDimensions.height,
        );
        generationImage = loadImageRegionToImageData(sourceProxy, proxyRegion, working);
        mask = samplePreviewMaskToRegion(
          refinedPreviewMask,
          previewWidth,
          previewHeight,
          sourceWidth,
          sourceHeight,
          region,
          working,
        );
        if (!mask.some((value) => value > 0)) {
          throw new GenerativeEditError('empty-mask', 'Mask refinement removed the edit region.');
        }
        maskWidth = working.width;
        maskHeight = working.height;
        sourceRegion = region;
        // The editable mask is authored on the bounded preview canvas, then
        // encoded row-by-row at source resolution for persistence. This keeps
        // the record's source-image-pixels contract without allocating a
        // source-sized RGBA working buffer.
        userMaskDataUrl = '';
        outputFrame = {
          x: 0,
          y: 0,
          width: sourceWidth,
          height: sourceHeight,
          sourceWidth,
          sourceHeight,
        };
      }
      const inferenceMaskDataUrl = maskCoverageDataUrl(mask, maskWidth, maskHeight);
      const preparedContext = extractBoundedContext(
        generationImage,
        mask,
        maskWidth,
        maskHeight,
        0,
        0,
        contextPadding,
      );
      const contextDataUrl = imageDataDataUrl(preparedContext.imageData);
      const generationSeed = seed ?? jobSnapshot.sourceRevision + variationSequenceRef.current;
      const needsDiffusion =
        mode === 'replace' || ((mode === 'fill' || mode === 'expand') && prompt.trim().length > 0);
      let modelPath: string | undefined;
      if (needsDiffusion) {
        if (!diffusionModelHandle) {
          throw new GenerativeEditError(
            'missing-model',
            'Install a compatible local diffusion model before using this prompt-capable mode.',
          );
        }
        // The native adapter resolves this opaque handle inside the desktop
        // process. Model filesystem paths never cross the IPC boundary.
      } else if (quality === 'ai') {
        const loader = getModelLoader();
        modelPath = (await loader.getModelPath(MODEL_ID, token.signal)) ?? undefined;
        if (!modelPath) {
          throw new GenerativeEditError(
            'missing-model',
            'AI model not found. Download it or choose Draft quality.',
          );
        }
      }

      const effectiveVariationCount = Math.min(
        variationCount,
        modeCapability.limits.maxVariations,
        MAX_BATCH_VARIATIONS,
      );
      const generatedVariations: Array<{
        id: string;
        dataUrl: string;
        thumbnailDataUrl: string;
        patchDataUrl: string;
        patchWidth: number;
        patchHeight: number;
        patchFrame?: SourceImageRegion;
        assetKind: 'full-output' | 'region-overlay';
        result: GenerativeEditResult;
        seed: number;
      }> = [];
      let expandFullResolutionSource: Awaited<ReturnType<typeof loadVisibleImageSource>> | null =
        null;
      if (mode === 'expand') {
        if (!expandContext) throw new Error('Expansion plan is unavailable');
        expandFullResolutionSource = await loadVisibleImageSource(
          expandContext.sourceBase,
          sourceWidth,
          sourceHeight,
          Math.max(sourceWidth, sourceHeight),
          overlaySources,
        );
      }
      for (let index = 0; index < effectiveVariationCount; index += 1) {
        const variationSeed = generationSeed + index;
        const generated = await runGenerativeEdit({
          mode,
          imageData: generationImage,
          mask,
          maskWidth,
          maskHeight,
          maskOffsetX: 0,
          maskOffsetY: 0,
          quality: quality === 'fast' ? 'draft' : 'quality',
          prompt,
          negativePrompt,
          seed: variationSeed,
          strength,
          steps,
          guidanceScale,
          imageGuidanceScale,
          contextPadding,
          outputWidth: generationImage.width,
          outputHeight: generationImage.height,
          signal: token.signal,
          isCurrent: isCurrentJob,
          onProgress: ({ stage, progress }) => {
            if (!isCurrentJob() || !jobControllerRef.current.update(token, progress, stage)) return;
            setGenerationProgress((index + progress) / effectiveVariationCount);
            setGenerationStage(
              `${stage[0]?.toUpperCase() + stage.slice(1)} · variation ${index + 1}/${effectiveVariationCount}`,
            );
          },
          modelPath,
          modelHandle: diffusionModelHandle ?? undefined,
        });
        let dataUrl: string;
        let thumbnailDataUrl: string;
        let patchDataUrl: string;
        let patchWidth: number;
        let patchHeight: number;
        let patchFrame: SourceImageRegion | undefined;
        let assetKind: 'full-output' | 'region-overlay';
        let displayResult: GenerativeEditResult;
        if (mode === 'expand') {
          if (!expandContext || !expandFullResolutionSource) {
            throw new Error('Expansion plan is unavailable');
          }
          const composed = composeExpandedFullResolution({
            source: expandFullResolutionSource,
            sourceWidth,
            sourceHeight,
            plan: expandContext.fullPlan,
            generated: generated.imageData,
            working: expandContext.working,
          });
          dataUrl = composed.toDataURL('image/png');
          thumbnailDataUrl = thumbnailDataUrlFromCanvas(composed);
          patchDataUrl = dataUrl;
          patchWidth = composed.width;
          patchHeight = composed.height;
          assetKind = 'full-output';
          const scaleX = composed.width / generated.width;
          const scaleY = composed.height / generated.height;
          displayResult = {
            ...generated,
            imageData: unloadedVariationImageData(),
            width: composed.width,
            height: composed.height,
            filledBounds: {
              x: generated.filledBounds.x * scaleX,
              y: generated.filledBounds.y * scaleY,
              w: generated.filledBounds.w * scaleX,
              h: generated.filledBounds.h * scaleY,
            },
          };
        } else {
          if (!sourceRegion) throw new Error('Generated source region is unavailable');
          const patchCanvas = renderGeneratedRegionToPatchCanvas({
            source: generationImage,
            result: generated,
            mask,
          });
          const previewBase = previewCanvasRef.current;
          if (!previewBase) throw new Error('Preview canvas is unavailable');
          const previewResultCanvas = renderGeneratedRegionToPreviewCanvas({
            preview: previewBase,
            previewWidth,
            previewHeight,
            sourceWidth,
            sourceHeight,
            region: sourceRegion,
            source: generationImage,
            result: generated,
            mask,
          });
          dataUrl = previewResultCanvas.toDataURL('image/png');
          thumbnailDataUrl = thumbnailDataUrlFromCanvas(previewResultCanvas);
          patchDataUrl = patchCanvas.toDataURL('image/png');
          patchWidth = patchCanvas.width;
          patchHeight = patchCanvas.height;
          patchFrame = sourceRegion;
          assetKind = 'region-overlay';
          displayResult = {
            ...generated,
            imageData: unloadedVariationImageData(),
            width: sourceWidth,
            height: sourceHeight,
            filledBounds: {
              x:
                sourceRegion.x +
                (generated.filledBounds.x * sourceRegion.width) / generationImage.width,
              y:
                sourceRegion.y +
                (generated.filledBounds.y * sourceRegion.height) / generationImage.height,
              w: (generated.filledBounds.w * sourceRegion.width) / generationImage.width,
              h: (generated.filledBounds.h * sourceRegion.height) / generationImage.height,
            },
          };
        }
        generatedVariations.push({
          id: `variation-${++variationSequenceRef.current}`,
          dataUrl,
          thumbnailDataUrl,
          patchDataUrl,
          patchWidth,
          patchHeight,
          patchFrame,
          assetKind,
          // Keep only the active last candidate decoded in JS memory. Earlier
          // candidates remain fully available through their compressed data
          // URLs/assets and are rehydrated as metadata-only candidates.
          result:
            index === effectiveVariationCount - 1
              ? displayResult
              : metadataOnlyVariationResult(displayResult),
          seed: variationSeed,
        });
      }
      const generated = generatedVariations[generatedVariations.length - 1];
      const currentSnapshot = currentJobSnapshotRef.current;
      if (
        !generated ||
        !currentSnapshot ||
        !jobControllerRef.current.isCurrent(token, {
          ...currentSnapshot,
          maskRevision: maskRevisionRef.current,
        })
      ) {
        throw new GenerativeEditError('stale', 'The source changed while generation was running.');
      }
      if (mode !== 'expand') {
        userMaskDataUrl = await encodePreviewMaskAtSourceSize(
          previewMask,
          previewWidth,
          previewHeight,
          sourceWidth,
          sourceHeight,
          token.signal,
        );
      }
      if (!isCurrentJob()) {
        throw new GenerativeEditError('stale', 'The source changed while saving the edit mask.');
      }
      if (
        !jobControllerRef.current.complete(token, {
          ...currentSnapshot,
          maskRevision: maskRevisionRef.current,
        })
      ) {
        throw new GenerativeEditError('stale', 'The source changed while finalizing the result.');
      }
      generationRef.current = {
        sourceSignature,
        userMaskDataUrl,
        inferenceMaskDataUrl,
        // Expand authors its mask as the full-frame border coverage at the
        // working output size; bounded modes author at source resolution.
        userMaskWidth: mode === 'expand' ? maskWidth : sourceWidth,
        userMaskHeight: mode === 'expand' ? maskHeight : sourceHeight,
        inferenceMaskWidth: maskWidth,
        inferenceMaskHeight: maskHeight,
        inferenceMaskOffsetX: sourceRegion?.x ?? 0,
        inferenceMaskOffsetY: sourceRegion?.y ?? 0,
        contextDataUrl,
        contextWidth: preparedContext.width,
        contextHeight: preparedContext.height,
        outputFrame,
        patchDataUrl: generated.patchDataUrl,
        patchWidth: generated.patchWidth,
        patchHeight: generated.patchHeight,
        patchFrame: generated.patchFrame,
        assetKind: generated.assetKind,
        result: generated.result,
        seed: generated.seed,
      };
      setVariations((previous) =>
        mergeGenerativeVariations(
          previous.map((variation) => ({
            ...variation,
            result: metadataOnlyVariationResult(variation.result),
          })),
          generatedVariations,
          activeVariationId,
          MAX_RETAINED_VARIATIONS,
        ),
      );
      setActiveVariationId(generated.id);
      setResult(generated.result);
      setPreviewDataUrl(generated.dataUrl);
      setIsRefiningMask(false);
      setShowOriginal(false);
      setStatus('idle');
    } catch (err) {
      if (token.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Generative edit failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [
    contextPadding,
    canGenerate,
    diffusionModelHandle,
    expandPadding,
    imageSrc,
    acceptedSourceAsset,
    maskExpansion,
    maskFeather,
    modeCapability,
    mode,
    modeAvailable,
    prompt,
    quality,
    sourceSignature,
    sourceAsset,
    overlaySources,
    negativePrompt,
    seed,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    variationCount,
  ]);

  const handleApply = useCallback(async () => {
    if (!nodeId || !previewDataUrl || !result) return;
    setStatus('applying');
    setErrorMessage(null);

    try {
      const currentDoc = state.document;
      const sourceNode = currentDoc.nodes[nodeId];
      if (sourceNode?.kind !== 'shape' || !isImageShape(sourceNode)) {
        throw new GenerativeEditError('stale', 'The source image no longer exists.');
      }
      if (!generationRef.current || generationRef.current.sourceSignature !== sourceSignature) {
        throw new GenerativeEditError(
          'stale',
          'The source changed. Generate a fresh result first.',
        );
      }

      const sourceFill =
        sourceNode.kind === 'shape'
          ? sourceNode.fills?.find((fill) => fill.type === 'image')?.image
          : undefined;
      const editId = `generative-edit-${Date.now()}-${++variationSequenceRef.current}`;
      const generatedFrame = generationRef.current.outputFrame;
      const sourceWidth = generatedFrame.sourceWidth || naturalSize.w || result.width;
      const sourceHeight = generatedFrame.sourceHeight || naturalSize.h || result.height;
      const currentSourceAsset = sourceFill?.assetId
        ? currentDoc.assets?.[sourceFill.assetId]
        : undefined;
      const sourceSnapshot =
        acceptedSourceAsset ??
        currentSourceAsset ??
        createEmbeddedAsset({
          dataUrl: imageSrc,
          mimeType: 'image/png',
          naturalWidth: sourceWidth,
          naturalHeight: sourceHeight,
        });
      const makeMaskAsset = (suffix: string, dataUrl: string, width: number, height: number) => ({
        id: `generative-mask-${editId}-${suffix}`,
        mimeType: 'image/png' as const,
        dataUrl,
        width,
        height,
        byteLength: decodedDataUrlByteLength(dataUrl),
        // Raster-mask validation reserves `checksum` for a real SHA-256
        // digest. The short FNV content id is useful for asset naming but is
        // not an integrity checksum and caused every generative mask to be
        // discarded by DocumentCodec on save/reopen.
        checksum: sha256Utf8(dataUrl),
      });
      const userMaskAsset = makeMaskAsset(
        'user',
        generationRef.current.userMaskDataUrl,
        generationRef.current.userMaskWidth,
        generationRef.current.userMaskHeight,
      );
      const inferenceMaskAsset = makeMaskAsset(
        'inference',
        generationRef.current.inferenceMaskDataUrl,
        generationRef.current.inferenceMaskWidth,
        generationRef.current.inferenceMaskHeight,
      );
      // The current compositing path uses the refined coverage. Keep a named
      // reference even when it is byte-identical so future providers can
      // distinguish the mask used for synthesis from the mask used for blend.
      const compositeMaskAsset = makeMaskAsset(
        'composite',
        generationRef.current.inferenceMaskDataUrl,
        generationRef.current.inferenceMaskWidth,
        generationRef.current.inferenceMaskHeight,
      );
      const contextAsset = createEmbeddedAsset({
        dataUrl: generationRef.current.contextDataUrl,
        mimeType: 'image/png',
        naturalWidth: generationRef.current.contextWidth,
        naturalHeight: generationRef.current.contextHeight,
      });
      const variationEntries =
        variations.length > 0
          ? variations
          : [
              {
                id: 'variation-1',
                dataUrl: previewDataUrl,
                thumbnailDataUrl: undefined,
                patchDataUrl: generationRef.current.patchDataUrl,
                patchWidth: generationRef.current.patchWidth,
                patchHeight: generationRef.current.patchHeight,
                patchFrame: generationRef.current.patchFrame,
                assetKind: generationRef.current.assetKind,
                result,
                seed: generationRef.current.seed,
              },
            ];
      const variationAssets = variationEntries.map((variation) =>
        createEmbeddedAsset({
          dataUrl: variation.patchDataUrl,
          mimeType: 'image/png',
          naturalWidth: variation.patchWidth,
          naturalHeight: variation.patchHeight,
        }),
      );
      const variationThumbnailAssets = variationEntries.map((variation, index) => {
        const thumbnailDataUrl = variation.thumbnailDataUrl ?? variation.dataUrl;
        if (thumbnailDataUrl === variation.dataUrl) return variationAssets[index]!;
        const dimensions = thumbnailDimensions(variation.result.width, variation.result.height);
        return createEmbeddedAsset({
          dataUrl: thumbnailDataUrl,
          mimeType: 'image/png',
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
        });
      });
      const activeVariation =
        variationEntries.find((variation) => variation.id === activeVariationId) ??
        variationEntries[variationEntries.length - 1]!;
      const activeAsset = variationAssets[variationEntries.indexOf(activeVariation)]!;
      const now = Date.now();
      const settings = {
        ...(generationRef.current.seed !== undefined ? { seed: generationRef.current.seed } : {}),
        ...(result.provider.id === 'varve-diffusion-inpainting' && prompt.trim() ? { prompt } : {}),
        ...(negativePrompt.trim() ? { negativePrompt } : {}),
        quality: result.quality,
        contextPadding,
        maskExpansion,
        feather: maskFeather,
        ...(usesDiffusion ? { strength, steps, guidanceScale } : {}),
        ...(usesDiffusion ? { imageGuidanceScale } : {}),
      };
      const outputFrame = {
        ...generatedFrame,
        sourceWidth,
        sourceHeight,
        coordinateSpace: 'source-image-pixels' as const,
      };
      const recordBase = {
        schemaVersion: 2 as const,
        id: editId,
        mode,
        sourceNodeId: nodeId,
        ...(sourceNode.generativeEditId && currentDoc.generativeEdits?.[sourceNode.generativeEditId]
          ? { parentEditId: sourceNode.generativeEditId }
          : {}),
        sourceAssetId: sourceSnapshot.id,
        sourceSnapshotAssetId: sourceSnapshot.id,
        sourceLocator: `asset:${sourceSnapshot.id}`,
        sourceRevision: state.revision,
        placementRevision: sourceSignature,
        masks: {
          userMaskAssetId: userMaskAsset.id,
          inferenceMaskAssetId: inferenceMaskAsset.id,
          compositeMaskAssetId: compositeMaskAsset.id,
          width: generationRef.current.inferenceMaskWidth,
          height: generationRef.current.inferenceMaskHeight,
          offsetX: generationRef.current.inferenceMaskOffsetX,
          offsetY: generationRef.current.inferenceMaskOffsetY,
          coordinateSpace: 'source-image-pixels' as const,
          userWidth: generationRef.current.userMaskWidth,
          userHeight: generationRef.current.userMaskHeight,
          userOffsetX: 0,
          userOffsetY: 0,
        },
        outputFrame,
        maskAssetId: userMaskAsset.id,
        maskWidth: generationRef.current.userMaskWidth,
        maskHeight: generationRef.current.userMaskHeight,
        maskCoordinateSpace: 'source-image-pixels' as const,
        settings,
        provider: result.provider,
        variations: variationEntries.map((variation, index) => ({
          id: variation.id,
          assetId: variationAssets[index]!.id,
          thumbnailAssetId: variationThumbnailAssets[index]!.id,
          width: variation.result.width,
          height: variation.result.height,
          createdAt: now,
          seed: variation.seed,
          settings: { ...settings, seed: variation.seed },
          assetKind: variation.assetKind,
          outputFrame: {
            ...outputFrame,
            ...(variation.patchFrame
              ? {
                  x: variation.patchFrame.x,
                  y: variation.patchFrame.y,
                  width: variation.patchFrame.width,
                  height: variation.patchFrame.height,
                }
              : {}),
          },
          provider: variation.result.provider,
          contextAssetId: contextAsset.id,
        })),
        activeVariationId: activeVariation.id,
        acceptedVariationId: activeVariation.id,
        createdAt: now,
        updatedAt: now,
      };

      const docWithAssets = {
        ...currentDoc,
        assets: {
          ...currentDoc.assets,
          [sourceSnapshot.id]: sourceSnapshot,
          ...Object.fromEntries(variationAssets.map((asset) => [asset.id, asset])),
          ...Object.fromEntries(variationThumbnailAssets.map((asset) => [asset.id, asset])),
          [contextAsset.id]: contextAsset,
        },
        rasterMaskAssets: {
          ...currentDoc.rasterMaskAssets,
          [userMaskAsset.id]: userMaskAsset,
          [inferenceMaskAsset.id]: inferenceMaskAsset,
          [compositeMaskAsset.id]: compositeMaskAsset,
        },
      };
      const accepted = replaceImageShapeContent(docWithAssets, nodeId, {
        dataUrl: sourceFill?.src ?? sourceSnapshot.dataUrl,
        assetId: sourceFill?.assetId ?? sourceSnapshot.id,
        generativeEditId: editId,
        width: sourceWidth,
        height: sourceHeight,
        ...(activeVariation.assetKind === 'region-overlay' && activeVariation.patchFrame
          ? {
              patch: {
                dataUrl: activeAsset.dataUrl,
                assetId: activeAsset.id,
                width: activeAsset.naturalWidth,
                height: activeAsset.naturalHeight,
                x: activeVariation.patchFrame.x,
                y: activeVariation.patchFrame.y,
                frameWidth: activeVariation.patchFrame.width,
                frameHeight: activeVariation.patchFrame.height,
                editId,
                variationId: activeVariation.id,
              },
            }
          : {
              dataUrl: activeAsset.dataUrl,
              assetId: activeAsset.id,
              width: result.width,
              height: result.height,
              ...(mode === 'expand'
                ? {
                    outputFrame: {
                      sourceOffsetX: -outputFrame.x,
                      sourceOffsetY: -outputFrame.y,
                      sourceWidth,
                      sourceHeight,
                    },
                  }
                : {}),
            }),
      });
      const record = { ...recordBase, resultNodeId: nodeId };
      beginTransaction();
      try {
        updateDoc(() => ({
          ...accepted,
          generativeEdits: { ...accepted.generativeEdits, [editId]: record },
        }));
        commitTransaction();
      } catch (error) {
        abortTransaction();
        throw error;
      }
      setSelection(nodeId);
      announce(
        `${mode[0]?.toUpperCase()}${mode.slice(1)} applied in place (${result.width} x ${result.height})`,
      );
      onApplied?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [
    nodeId,
    previewDataUrl,
    result,
    abortTransaction,
    beginTransaction,
    commitTransaction,
    contextPadding,
    acceptedSourceAsset,
    variations,
    activeVariationId,
    mode,
    sourceSignature,
    imageSrc,
    state.document,
    state.revision,
    maskExpansion,
    maskFeather,
    setSelection,
    updateDoc,
    announce,
    negativePrompt,
    onApplied,
    onClose,
    prompt,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    usesDiffusion,
  ]);

  const handleDeleteVariation = useCallback(
    (variationId: string, variationNumber: number) => {
      if (variations.length <= 1) return;
      const removedIndex = variations.findIndex((variation) => variation.id === variationId);
      const nextVariations = variations.filter((variation) => variation.id !== variationId);
      const nextActive =
        activeVariationId === variationId
          ? nextVariations[Math.min(removedIndex, nextVariations.length - 1)]
          : (nextVariations.find((variation) => variation.id === activeVariationId) ??
            nextVariations[0]);
      setVariations(nextVariations);
      if (nextActive) {
        setActiveVariationId(nextActive.id);
        setResult(nextActive.result);
        setPreviewDataUrl(nextActive.dataUrl);
        if (generationRef.current) {
          generationRef.current.result = nextActive.result;
          generationRef.current.seed = nextActive.seed;
          generationRef.current.patchDataUrl = nextActive.patchDataUrl;
          generationRef.current.patchWidth = nextActive.patchWidth;
          generationRef.current.patchHeight = nextActive.patchHeight;
          generationRef.current.patchFrame = nextActive.patchFrame;
          generationRef.current.assetKind = nextActive.assetKind;
        }
      }
      announce(`Deleted variation ${variationNumber}`);
    },
    [activeVariationId, announce, variations],
  );

  if (!isOpen && !dialogRef.current?.open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="varve-dialog varve-dialog--caf"
      aria-labelledby="caf-dialog-title"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!isProcessing) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isProcessing) onClose();
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') adjustZoom(25);
        if (e.key === '-') adjustZoom(-25);
        if (e.key === '0') selectFitZoom();
        if (e.key === '1') selectOneToOneZoom();
      }}
    >
      <div className="varve-dialog__header">
        <h2 id="caf-dialog-title" className="varve-dialog__title">
          Content-Aware Fill
        </h2>
        <button
          type="button"
          className="varve-dialog__close"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={isProcessing}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="caf-dialog__body">
        <div className="caf-dialog__left">
          <div className="caf-dialog__section">
            <span className="caf-dialog__label">Mode</span>
            <div
              className="caf-dialog__mode-options"
              role="tablist"
              aria-label="Generative edit mode"
            >
              {(['fill', 'remove', 'replace', 'expand'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={mode === candidate}
                  className={`caf-dialog__mode-btn${mode === candidate ? ' caf-dialog__mode-btn--active' : ''}`}
                  onClick={() => {
                    if (mode === 'expand' && candidate !== 'expand') resetPreviewToSource();
                    setMode(candidate);
                    invalidatePreview();
                  }}
                >
                  {candidate[0]?.toUpperCase()}
                  {candidate.slice(1)}
                </button>
              ))}
            </div>
            <p className="caf-dialog__hint">
              {modeAvailable
                ? mode === 'expand'
                  ? 'Set one or more sides to extend. Original pixels keep their world position.'
                  : 'Paint the pixels to regenerate. The source is retained for Restore Original.'
                : diffusionResource &&
                    diffusionResource.availableBytes != null &&
                    diffusionResource.availableBytes < diffusionResource.requiredBytes
                  ? `This ${diffusionResource.architecture} device has about ${Math.floor(diffusionResource.availableBytes / 1_048_576)} MiB available, but local diffusion needs about ${Math.ceil(diffusionResource.requiredBytes / 1_048_576)} MiB. Use Quick Cleanup for this edit.`
                  : (modeUnavailableReason ??
                    capabilities.reason ??
                    diffusionModelReason ??
                    'This mode is unavailable.')}
            </p>
          </div>

          {(mode === 'fill' || mode === 'replace' || mode === 'expand') && (
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-prompt">
                Prompt{' '}
                <span className="caf-dialog__optional">
                  {mode === 'replace' ? 'required' : 'optional'}
                </span>
              </label>
              <textarea
                id="caf-dialog-prompt"
                className="caf-dialog__prompt"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  invalidatePreview();
                }}
                placeholder="Describe what should appear here"
                rows={3}
                aria-describedby="caf-dialog-prompt-note caf-dialog-provider-note"
                disabled={!modeCapability.prompt || isProcessing}
              />
              <p id="caf-dialog-prompt-note" className="caf-dialog__hint">
                {modeCapability.prompt
                  ? 'Sent only to the locally installed diffusion model; it never leaves this device.'
                  : mode === 'expand' && !modeCapability.available
                    ? 'Prompt conditioning and browser outpainting are unavailable here. Use the desktop app after a local provider passes qualification.'
                    : 'Prompt conditioning is unavailable in the browser. Install the desktop diffusion model to use it.'}
              </p>
              {modeCapability.prompt && (
                <>
                  <label className="caf-dialog__label" htmlFor="caf-dialog-negative-prompt">
                    Negative prompt <span className="caf-dialog__optional">optional</span>
                  </label>
                  <textarea
                    id="caf-dialog-negative-prompt"
                    className="caf-dialog__prompt"
                    value={negativePrompt}
                    onChange={(event) => {
                      setNegativePrompt(event.target.value);
                      invalidatePreview();
                    }}
                    placeholder="Things to avoid"
                    rows={2}
                  />
                </>
              )}
            </div>
          )}

          <div className="caf-dialog__provider" id="caf-dialog-provider-note">
            <span className="caf-dialog__provider-dot" aria-hidden="true" />
            <span>
              <strong>Local processing</strong>
              <small>
                {usesDiffusion
                  ? diffusionModelHandle
                    ? `Diffusion · ${Math.round(diffusionModelSize / 1_000_000)} MB · qualified local${diffusionResource ? ` · ${diffusionResource.backend}/${diffusionResource.platform}/${diffusionResource.architecture}` : ''}`
                    : diffusionModelInstalled
                      ? 'Diffusion model installed · validation required'
                      : 'Diffusion model required · local only'
                  : quality === 'fast'
                    ? 'Quick Cleanup · no download'
                    : 'LaMa · stored on this device'}
                {resourceLabel ? ` · ${resourceLabel}` : ''}
              </small>
            </span>
          </div>

          <p className="caf-dialog__hint" aria-live="polite">
            {resourceProfile.summary}
          </p>

          {usesDiffusion && (
            <div className="caf-dialog__section">
              {!diffusionModelInstalled && capabilities.prompt && status !== 'downloading' && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void handleDownloadDiffusionModel()}
                  disabled={isProcessing}
                >
                  Download {Math.round(NATIVE_GENERATIVE_MODEL_PROFILE.sizeBytes / 1_000_000)} MB
                  model
                </Button>
              )}
              {status === 'downloading' && (
                <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
                  Cancel download
                </Button>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleImportDiffusionModel()}
                disabled={!modeCapability.prompt || isProcessing}
              >
                {diffusionModelInstalled ? 'Replace Diffusion Model' : 'Install Diffusion Model'}
              </Button>
              {status === 'downloading' && (
                <p className="caf-dialog__hint" aria-live="polite">
                  Downloading local model… {downloadProgress}%
                </p>
              )}
              {diffusionModelInstalled && !diffusionModelHandle && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleQualifyDiffusionModel()}
                  disabled={isProcessing}
                >
                  Validate Model
                </Button>
              )}
              <p className="caf-dialog__hint">
                {diffusionResource?.availableBytes != null &&
                  diffusionResource.availableBytes < diffusionResource.requiredBytes && (
                    <>
                      Low-memory guard: about{' '}
                      {Math.floor(diffusionResource.availableBytes / 1_048_576)} MiB available; this
                      model needs about {Math.ceil(diffusionResource.requiredBytes / 1_048_576)}{' '}
                      MiB. Use Quick Cleanup or a smaller edit region.{' '}
                    </>
                  )}
                {diffusionResource?.availableBytes != null &&
                  diffusionResource.availableBytes >= diffusionResource.requiredBytes && (
                    <>
                      {diffusionResource.tier} memory · {diffusionResource.backend}/
                      {diffusionResource.platform}/{diffusionResource.architecture} · measured
                      before generation.{' '}
                    </>
                  )}
                {diffusionModelHandle
                  ? 'The model passed a masked production-helper check and is managed offline.'
                  : diffusionModelInstalled
                    ? (diffusionModelReason ??
                      'Run validation before using prompt-capable generation.')
                    : 'Select a safe-format SD 1.5/SDXL inpainting model. Legacy checkpoint files are rejected. Browser generation is unavailable.'}
              </p>
            </div>
          )}

          {usesDiffusion && (
            <div className="caf-dialog__refinement-grid">
              <div className="caf-dialog__section">
                <label className="caf-dialog__label" htmlFor="caf-dialog-strength">
                  Strength: {Math.round(strength * 100)}%
                </label>
                <input
                  id="caf-dialog-strength"
                  type="range"
                  className="varve-native-range caf-dialog__range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={strength}
                  onChange={(event) => {
                    setStrength(Number(event.target.value));
                    invalidatePreview();
                  }}
                  disabled={isProcessing}
                />
              </div>
              <div className="caf-dialog__section">
                <label className="caf-dialog__label" htmlFor="caf-dialog-steps">
                  Steps: {steps}
                </label>
                <input
                  id="caf-dialog-steps"
                  type="range"
                  className="varve-native-range caf-dialog__range"
                  min={4}
                  max={100}
                  step={1}
                  value={steps}
                  onChange={(event) => {
                    setSteps(Number(event.target.value));
                    invalidatePreview();
                  }}
                  disabled={isProcessing}
                />
              </div>
              <div className="caf-dialog__section">
                <label className="caf-dialog__label" htmlFor="caf-dialog-guidance">
                  Guidance: {guidanceScale}
                </label>
                <input
                  id="caf-dialog-guidance"
                  type="range"
                  className="varve-native-range caf-dialog__range"
                  min={0}
                  max={20}
                  step={0.5}
                  value={guidanceScale}
                  onChange={(event) => {
                    setGuidanceScale(Number(event.target.value));
                    invalidatePreview();
                  }}
                  disabled={isProcessing}
                />
              </div>
              {modeCapability.supportedParameters.includes('imageGuidanceScale') && (
                <div className="caf-dialog__section">
                  <label className="caf-dialog__label" htmlFor="caf-dialog-image-guidance">
                    Image guidance: {imageGuidanceScale}
                  </label>
                  <input
                    id="caf-dialog-image-guidance"
                    type="range"
                    className="varve-native-range caf-dialog__range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={imageGuidanceScale}
                    onChange={(event) => {
                      setImageGuidanceScale(Number(event.target.value));
                      invalidatePreview();
                    }}
                    disabled={isProcessing}
                  />
                </div>
              )}
            </div>
          )}

          <div className="caf-dialog__section">
            <span className="caf-dialog__label">Mask source</span>
            <div className="caf-dialog__mask-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleUsePixelSelection}
                disabled={!areaSelection || hasResult || isProcessing}
              >
                Use Pixel Selection
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleUseObjectSelection}
                disabled={objectSelection?.status !== 'ready' || hasResult || isProcessing}
              >
                Use Object Selection
              </Button>
              {objectSelection?.status !== 'ready' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleStartObjectSelection}
                  disabled={hasMaskStrokes || hasResult || isProcessing}
                >
                  Start Object Selection
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleUseLayerMask()}
                disabled={!layerMaskAsset || hasResult || isProcessing}
              >
                Use Layer Mask
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleUseBackgroundRemovalPreview()}
                disabled={
                  !backgroundRemovalPreview ||
                  naturalSize.w <= 0 ||
                  naturalSize.h <= 0 ||
                  hasResult ||
                  isProcessing
                }
              >
                Use Background Removal Preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleUseImageAlpha()}
                disabled={!imageSrc || hasResult || isProcessing}
              >
                Use Image Alpha
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleInvertMask}
                disabled={!hasMaskStrokes || hasResult || isProcessing}
              >
                Invert
              </Button>
            </div>
            <fieldset className="caf-dialog__mask-operations">
              <legend className="caf-dialog__label">Mask operation</legend>
              {(
                [
                  ['replace', 'Replace'],
                  ['add', 'Add'],
                  ['subtract', 'Subtract'],
                  ['intersect', 'Intersect'],
                ] as const
              ).map(([operation, label]) => (
                <button
                  key={operation}
                  type="button"
                  className={`caf-dialog__mask-operation${maskOperation === operation ? ' caf-dialog__mask-operation--active' : ''}`}
                  aria-pressed={maskOperation === operation}
                  disabled={hasResult || isProcessing}
                  onClick={() => {
                    setMaskOperation(operation);
                    announce(`Mask operation: ${label}`);
                  }}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <p className="caf-dialog__hint" aria-live="polite">
              {maskOrigin === 'pixel-selection'
                ? 'Using the current document pixel selection.'
                : maskOrigin === 'layer-mask'
                  ? 'Using the selected image layer mask.'
                  : maskOrigin === 'image-alpha'
                    ? 'Using the source image alpha channel.'
                    : maskOrigin === 'object-selection'
                      ? 'Using the confirmed Object Selection candidate; refine it with the brush.'
                      : maskOrigin === 'background-removal'
                        ? 'Using the Background Removal preview as an editable mask; refine it with the brush before generating.'
                        : maskOrigin === 'persisted'
                          ? 'Using the accepted edit mask.'
                          : 'Paint directly on the source to define the edit region.'}
            </p>
          </div>

          {mode === 'expand' && (
            <div className="caf-dialog__section">
              <span className="caf-dialog__label">Expansion (source pixels)</span>
              <div className="caf-dialog__expand-presets">
                <label className="caf-dialog__expand-control">
                  <span>Aspect ratio</span>
                  <select
                    id="caf-expand-aspect-ratio"
                    value={expandAspectRatio}
                    onChange={(event) => setExpandAspectRatio(event.target.value)}
                    disabled={isProcessing}
                  >
                    {EXPAND_ASPECT_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="caf-dialog__expand-control">
                  <span>Source anchor</span>
                  <select
                    id="caf-expand-anchor"
                    value={expandAnchor}
                    onChange={(event) => setExpandAnchor(event.target.value as ExpandAnchor)}
                    disabled={isProcessing}
                  >
                    <option value="center">Center</option>
                    <option value="top-left">Top left</option>
                    <option value="top">Top</option>
                    <option value="top-right">Top right</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom">Bottom</option>
                    <option value="bottom-right">Bottom right</option>
                  </select>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={expandAspectRatio === 'free' || isProcessing || naturalSize.w <= 0}
                  onClick={() => {
                    const preset = EXPAND_ASPECT_PRESETS.find(
                      (candidate) => candidate.id === expandAspectRatio,
                    );
                    if (!preset?.ratio || naturalSize.w <= 0 || naturalSize.h <= 0) return;
                    try {
                      const padding = expandPaddingForAspectRatio(
                        naturalSize.w,
                        naturalSize.h,
                        preset.ratio,
                        expandAnchor,
                      );
                      setExpandPadding(padding);
                      setExpandTargetWidth(String(naturalSize.w + padding.left + padding.right));
                      setExpandTargetHeight(String(naturalSize.h + padding.top + padding.bottom));
                      invalidatePreview();
                    } catch (error) {
                      setErrorMessage(
                        error instanceof Error ? error.message : 'The aspect ratio is invalid.',
                      );
                    }
                  }}
                >
                  Set ratio
                </Button>
              </div>
              <div className="caf-dialog__expand-target">
                <label className="caf-dialog__expand-control" htmlFor="caf-expand-width">
                  <span>Output width</span>
                  <input
                    id="caf-expand-width"
                    type="number"
                    min={naturalSize.w || 1}
                    max={8192}
                    step={1}
                    value={expandTargetWidth}
                    placeholder={naturalSize.w ? String(naturalSize.w) : 'Source width'}
                    onChange={(event) => setExpandTargetWidth(event.target.value)}
                    disabled={isProcessing}
                  />
                </label>
                <label className="caf-dialog__expand-control" htmlFor="caf-expand-height">
                  <span>Output height</span>
                  <input
                    id="caf-expand-height"
                    type="number"
                    min={naturalSize.h || 1}
                    max={8192}
                    step={1}
                    value={expandTargetHeight}
                    placeholder={naturalSize.h ? String(naturalSize.h) : 'Source height'}
                    onChange={(event) => setExpandTargetHeight(event.target.value)}
                    disabled={isProcessing}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={
                    isProcessing ||
                    naturalSize.w <= 0 ||
                    naturalSize.h <= 0 ||
                    !expandTargetWidth ||
                    !expandTargetHeight
                  }
                  onClick={() => {
                    const outputWidth = Number(expandTargetWidth);
                    const outputHeight = Number(expandTargetHeight);
                    try {
                      const padding = expandPaddingForOutputSize(
                        naturalSize.w,
                        naturalSize.h,
                        outputWidth,
                        outputHeight,
                        expandAnchor,
                      );
                      setExpandPadding(padding);
                      setExpandAspectRatio('free');
                      invalidatePreview();
                    } catch (error) {
                      setErrorMessage(
                        error instanceof Error ? error.message : 'The output frame is invalid.',
                      );
                    }
                  }}
                >
                  Set size
                </Button>
              </div>
              <div className="caf-dialog__expand-grid">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <label key={side} className="caf-dialog__expand-field">
                    <span>{side}</span>
                    <input
                      id={`caf-expand-${side}`}
                      type="number"
                      min={0}
                      max={4096}
                      step={1}
                      value={expandPadding[side]}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(4096, Number(event.target.value) || 0));
                        const nextPadding = { ...expandPadding, [side]: value };
                        setExpandPadding(nextPadding);
                        setExpandAspectRatio('free');
                        if (naturalSize.w > 0 && naturalSize.h > 0) {
                          setExpandTargetWidth(
                            String(naturalSize.w + nextPadding.left + nextPadding.right),
                          );
                          setExpandTargetHeight(
                            String(naturalSize.h + nextPadding.top + nextPadding.bottom),
                          );
                        }
                        invalidatePreview();
                      }}
                      disabled={isProcessing}
                    />
                  </label>
                ))}
              </div>
              <p className="caf-dialog__hint">
                Expansion generates only the new bounds; existing pixels are copied unchanged.
              </p>
              {expandPlanPreview && !expandPlanPreview.ok && (
                <p className="caf-dialog__error" role="status">
                  {expandPlanPreview.error.message}
                </p>
              )}
              {expandPlanPreview?.ok && !expandPlanPreview.plan.isNoop && (
                <p className="caf-dialog__hint">
                  Output {expandPlanPreview.plan.outputWidth} x{' '}
                  {expandPlanPreview.plan.outputHeight} px.{' '}
                  {estimateExpandGenerationResolution(expandPlanPreview.plan, 512).disclosure}
                </p>
              )}
            </div>
          )}

          <div className="caf-dialog__section">
            <span className="caf-dialog__label">Quality</span>
            <div className="caf-dialog__quality-options">
              {(['fast', 'ai'] as const).map((q) => (
                <label
                  key={q}
                  className={`caf-dialog__quality-btn${quality === q ? ' caf-dialog__quality-btn--active' : ''}`}
                >
                  <input
                    type="radio"
                    name="caf-quality"
                    value={q}
                    checked={quality === q}
                    onChange={() => {
                      setQuality(q);
                      invalidatePreview();
                    }}
                    className="caf-dialog__quality-input"
                  />
                  <span className="caf-dialog__quality-label">{QUALITY_LABELS[q]}</span>
                  <span className="caf-dialog__quality-desc">{QUALITY_DESCRIPTIONS[q]}</span>
                </label>
              ))}
            </div>
          </div>

          {quality === 'ai' &&
            modelFitsMemory !== false &&
            !modelAvailable &&
            status !== 'downloading' && (
              <div className="caf-dialog__section">
                <Button type="button" variant="default" size="sm" onClick={handleDownload}>
                  Download AI Model (~208 MB)
                </Button>
                <p className="caf-dialog__hint">One-time download required. Stored locally.</p>
              </div>
            )}
          {quality === 'ai' && modelFitsMemory === false && (
            <p className="caf-dialog__hint" role="status">
              AI quality is unavailable on this device's current memory budget. Choose Fast / Quick
              Cleanup; it runs without loading a model and remains suitable for small repairs.
            </p>
          )}

          {status === 'downloading' && (
            <div className="caf-dialog__section">
              <div
                className="caf-dialog__progress"
                role="progressbar"
                aria-valuenow={downloadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="caf-dialog__progress-fill"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <p className="caf-dialog__hint" aria-live="polite">
                Downloading… {downloadProgress}%
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
                Cancel
              </Button>
            </div>
          )}

          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-brush">
              Brush: {brushSize}px
            </label>
            <input
              id="caf-dialog-brush"
              type="range"
              className="varve-native-range caf-dialog__range"
              min={8}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </div>

          <div className="caf-dialog__refinement-grid">
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-mask-expansion">
                {maskExpansion < 0 ? 'Shrink mask' : 'Grow mask'}: {Math.abs(maskExpansion)}px
              </label>
              <input
                id="caf-dialog-mask-expansion"
                type="range"
                className="varve-native-range caf-dialog__range"
                min={-64}
                max={64}
                step={1}
                value={maskExpansion}
                onChange={(event) => {
                  setMaskExpansion(Number(event.target.value));
                  invalidatePreview();
                }}
              />
            </div>
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-mask-feather">
                Feather: {maskFeather}px
              </label>
              <input
                id="caf-dialog-mask-feather"
                type="range"
                className="varve-native-range caf-dialog__range"
                min={0}
                max={64}
                step={1}
                value={maskFeather}
                onChange={(event) => {
                  setMaskFeather(Number(event.target.value));
                  invalidatePreview();
                }}
              />
            </div>
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-context-padding">
                Context: {contextPadding}px
              </label>
              <input
                id="caf-dialog-context-padding"
                type="range"
                className="varve-native-range caf-dialog__range"
                min={8}
                max={256}
                step={8}
                value={contextPadding}
                onChange={(event) => {
                  setContextPadding(Number(event.target.value));
                  invalidatePreview();
                }}
              />
            </div>
          </div>

          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-variation-count">
              Variations
            </label>
            <input
              id="caf-dialog-variation-count"
              type="number"
              min={1}
              max={modeCapability.limits.maxVariations}
              step={1}
              value={variationCount}
              onChange={(event) =>
                setVariationCount(
                  Math.max(
                    1,
                    Math.min(modeCapability.limits.maxVariations, Number(event.target.value) || 1),
                  ),
                )
              }
              disabled={!modeCapability.variations || hasResult || isProcessing}
            />
            <label className="caf-dialog__label" htmlFor="caf-dialog-seed">
              Seed <span className="caf-dialog__optional">optional</span>
            </label>
            <input
              id="caf-dialog-seed"
              type="number"
              value={seed ?? ''}
              placeholder="Random per generation"
              onChange={(event) => {
                const value = event.target.value.trim();
                setSeed(value === '' ? null : Number(value));
                invalidatePreview();
              }}
              disabled={isProcessing}
            />
          </div>

          {!hasResult && (
            <div className="caf-dialog__section">
              <Switch
                className="caf-dialog__checkbox"
                label="Show mask overlay"
                checked={maskVisible}
                onChange={(e) => setMaskVisible(e.target.checked)}
              />
            </div>
          )}

          {hasResult && (
            <div className="caf-dialog__section">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleEditMask}
                disabled={isProcessing}
              >
                Edit mask
              </Button>
            </div>
          )}

          <div className="caf-dialog__section">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearMask}
              disabled={!hasMaskStrokes || hasResult || isProcessing}
            >
              Clear Paint
            </Button>
          </div>

          <div className="caf-dialog__section caf-dialog__section--grow">
            {isProcessing ? (
              <div className="caf-dialog__status">
                <span aria-live="polite">
                  {status === 'qualifying'
                    ? 'Validating local diffusion model…'
                    : status === 'generating'
                      ? `${generationStage}… ${Math.round(generationProgress * 100)}%`
                      : 'Applying…'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (status === 'downloading') {
                      handleCancelDownload();
                    } else if (status === 'qualifying') {
                      handleCancelQualification();
                    } else {
                      jobControllerRef.current.cancel();
                      setStatus('idle');
                    }
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!modeAvailable || !canGenerate}
                onClick={handleGenerate}
              >
                {hasResult
                  ? 'Regenerate'
                  : mode === 'remove'
                    ? 'Remove && Fill'
                    : `${mode[0]?.toUpperCase()}${mode.slice(1)}`}
              </Button>
            )}
          </div>

          {status === 'error' && errorMessage && (
            <p className="caf-dialog__error" role="alert">
              {errorMessage}
            </p>
          )}

          {variations.length > 0 && (
            <fieldset className="caf-dialog__section caf-dialog__variations-fieldset">
              <legend className="caf-dialog__label">Variations</legend>
              <div className="caf-dialog__variations">
                {variations.map((variation, index) => (
                  <div className="caf-dialog__variation-card" key={variation.id}>
                    <button
                      type="button"
                      className={`caf-dialog__variation${activeVariationId === variation.id ? ' caf-dialog__variation--active' : ''}`}
                      disabled={isRefiningMask || isProcessing}
                      onClick={() => {
                        setActiveVariationId(variation.id);
                        setResult(variation.result);
                        setPreviewDataUrl(variation.dataUrl);
                        if (generationRef.current) {
                          generationRef.current.result = variation.result;
                          generationRef.current.seed = variation.seed;
                          generationRef.current.patchDataUrl = variation.patchDataUrl;
                          generationRef.current.patchWidth = variation.patchWidth;
                          generationRef.current.patchHeight = variation.patchHeight;
                          generationRef.current.patchFrame = variation.patchFrame;
                          generationRef.current.assetKind = variation.assetKind;
                        }
                      }}
                      aria-label={`Variation ${index + 1}`}
                      aria-pressed={activeVariationId === variation.id}
                    >
                      <img
                        src={variation.thumbnailDataUrl ?? variation.dataUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span>{index + 1}</span>
                    </button>
                    <button
                      type="button"
                      className="caf-dialog__variation-delete"
                      aria-label={`Delete variation ${index + 1}`}
                      disabled={variations.length <= 1 || isProcessing}
                      onClick={() => handleDeleteVariation(variation.id, index + 1)}
                    >
                      {String.fromCharCode(215)}
                    </button>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <div className="caf-dialog__right">
          <div className="caf-dialog__preview-toolbar">
            <div className="caf-dialog__preview-toggles">
              {hasResult && (
                <button
                  type="button"
                  className={`caf-dialog__toggle-btn${showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
                  onClick={() => setShowOriginal(true)}
                >
                  Original
                </button>
              )}
              {hasResult && (
                <button
                  type="button"
                  className={`caf-dialog__toggle-btn${!showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
                  onClick={() => setShowOriginal(false)}
                >
                  Result
                </button>
              )}
              {!hasResult && <span className="caf-dialog__preview-label">Source</span>}
            </div>
            <div className="caf-dialog__preview-zoom">
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Zoom out"
                onClick={() => adjustZoom(-25)}
                disabled={previewZoom === 'custom' && zoomPercent <= 25}
              >
                −
              </button>
              <span className="caf-dialog__zoom-value" aria-live="polite">
                {previewZoom === 'fit' ? 'Fit' : `${zoomPercent}%`}
              </span>
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Zoom in"
                onClick={() => adjustZoom(25)}
                disabled={previewZoom === 'custom' && zoomPercent >= 400}
              >
                +
              </button>
              <button
                type="button"
                className={`caf-dialog__zoom-btn${previewZoom === 'fit' ? ' caf-dialog__zoom-btn--active' : ''}`}
                onClick={selectFitZoom}
              >
                Fit
              </button>
              <button
                type="button"
                className={`caf-dialog__zoom-btn${previewZoom === 'custom' && zoomPercent === 100 ? ' caf-dialog__zoom-btn--active' : ''}`}
                onClick={selectOneToOneZoom}
              >
                1:1
              </button>
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Center preview"
                onClick={centerPreview}
              >
                Center
              </button>
            </div>
          </div>

          <div
            ref={previewAreaRef}
            className={`caf-dialog__preview-area${previewZoom === 'custom' ? ' caf-dialog__preview-area--zoom' : ''}`}
          >
            <div
              className="caf-dialog__preview-stage"
              style={
                displayWidth > 0 && displayHeight > 0
                  ? { width: `${displayWidth}px`, height: `${displayHeight}px` }
                  : undefined
              }
            >
              <canvas
                ref={previewCanvasRef}
                className={`caf-dialog__preview-canvas${showOriginal || !hasResult ? ' caf-dialog__preview-canvas--visible' : ''}`}
              />

              {hasResult && previewDataUrl && (
                <img
                  src={previewDataUrl}
                  alt="Fill result"
                  className={`caf-dialog__preview-canvas${!showOriginal ? ' caf-dialog__preview-canvas--visible' : ''}`}
                />
              )}

              {!hasResult && (
                <canvas
                  ref={maskCanvasRef}
                  className="caf-dialog__mask-canvas"
                  style={{ opacity: maskVisible ? 0.45 : 0 }}
                  aria-label="Paint removal mask"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="caf-dialog__footer">
        <div className="caf-dialog__footer-info">
          {status === 'generating' && (
            <span className="caf-dialog__footer-text" aria-live="polite">
              Running fill…
            </span>
          )}
          {status === 'error' && errorMessage && (
            <span className="caf-dialog__footer-text caf-dialog__footer-text--error" role="alert">
              {errorMessage}
            </span>
          )}
          {status === 'idle' && hasResult && result?.warnings[0] && (
            <span className="caf-dialog__footer-text" title={result.warnings.join(' ')}>
              {result.provider.kind === 'local' ? 'Local result' : 'Provider result'} ·{' '}
              {result.warnings[0]}
            </span>
          )}
        </div>
        <div className="caf-dialog__footer-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!hasResult || isProcessing}
            loading={status === 'applying'}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </div>
    </dialog>
  );
}
