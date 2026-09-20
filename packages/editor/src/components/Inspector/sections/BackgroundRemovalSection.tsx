/**
 * BackgroundRemovalSection — image cutout controls in the Properties panel.
 *
 * Layout / chrome match Appearance/Fill: DisclosureSection, FieldRow,
 * insp-select, NumberField, @varve/ui Button (replacing unstyled button--*).
 *
 * Research basis: Figma generative fill panel density; APG form disclosure.
 */

import type {
  AreaSelectionOperation,
  PromptedProviderPreference,
  RemovalMethod,
} from '@varve/engine';
import {
  combineAreaSelections,
  DEFAULT_PREVIEW_MAX_DIMENSION,
  EFFICIENT_SAM_PROVIDER_ID,
  getEnvironmentCapabilities,
  getModelInfo,
  getModelLoaderReady,
  isWasmModelSafe,
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  SAM2_PROVIDER_ID,
  workerModelIdForMethod,
} from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape, resolveNodePaints } from '@varve/scene';
import { Button, Select, ShineBorder, Switch } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { removeRasterMaskFromNode } from '../../../backgroundRemoval/commitRasterMask';
import { getToolManager } from '../../../canvas/toolDispatcher';
import { isCapabilityRestricted } from '../../../capabilities/restrictions';
import { useEditor } from '../../../context';
import { objectSelectionCandidateReviewKey } from '../../../context/objectSelectionTypes';
import { prepareImageMaskMapper } from '../../../tools/imageMaskCoordinates';
import type {
  Sam2PromptMode,
  Sam2PromptPolarity,
  Sam2SegmentationTool,
} from '../../../tools/Sam2SegmentationTool';
import { mapSourceSam2PromptsToWorld } from '../../../tools/sam2PromptCoordinates';
import { areaSelectionFromMaskCoverage } from '../../../tools/selectionMask';
import { ModelDownloadDialog } from '../../BackgroundRemoval/ModelDownloadDialog';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { RangeValueControl } from '../controls/RangeValueControl';
import { BoundedImagePreview } from './ImageFillControls';
import { TextDiscoveryPanel } from './TextDiscoveryPanel';

function normalizeErrorMessage(e: unknown, defaultMessage: string): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message === 'cancelled' || message === 'AbortError' || message.includes('aborted')) {
    return 'Cancelled';
  }
  if (message.includes('request deadline')) {
    return 'AI processing reached its time limit. Try Fast for a simple background, or choose a smaller local model in Settings, Offline Models.';
  }
  if (message.includes('timed out')) {
    return 'Timed out while waiting for the AI model. Switch to Quick mode or try again.';
  }
  if (message.includes('too large') || message.includes('Image too large')) {
    return 'Image too large for this AI model.';
  }
  if (message.includes('exceeds the safe WASM memory limit')) {
    return 'AI Quality model exceeds available memory without GPU acceleration. Switch to AI Balanced, or use Quick mode and manually refine the mask with the brush and trimap tools.';
  }
  if (message.includes('AI background removal failed in all quality modes')) {
    return 'AI background removal failed in every mode on this device. Use Quick mode, then manually refine the mask with the brush and trimap tools below.';
  }
  if (message.includes('Model') || message.includes('model')) {
    return `Model failed to load: ${defaultMessage}`;
  }
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

function normalizeObjectSelectionDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/checksum|integrity|corrupt/i.test(message)) {
    return 'The Object Selection model failed its integrity check. Remove it from Settings > Offline Models and download it again.';
  }
  if (/network|fetch|http|download/i.test(message)) {
    return 'The Object Selection model could not be downloaded. Check your connection and try again.';
  }
  if (/space|quota|storage|disk/i.test(message)) {
    return 'There is not enough storage for the Object Selection model. Free space and try again.';
  }
  if (/cancel|abort/i.test(message)) return 'Object Selection model download cancelled.';
  return 'The Object Selection model could not be installed. Try again from Settings > Offline Models.';
}

function objectSelectionScoreLabel(
  source:
    | 'predicted-iou'
    | 'stability'
    | 'heuristic'
    | 'model-iou'
    | 'activation-heuristic'
    | undefined,
): string {
  return source === 'predicted-iou' || source === 'model-iou'
    ? 'predicted IoU score'
    : source === 'stability'
      ? 'stability score'
      : source === 'heuristic' || source === 'activation-heuristic'
        ? 'heuristic score'
        : 'score';
}

function formatObjectSelectionScore(
  score: number,
  source: Parameters<typeof objectSelectionScoreLabel>[0],
): string {
  if (source === 'predicted-iou' || source === 'model-iou') {
    return `${objectSelectionScoreLabel(source)} ${score.toFixed(2)}`;
  }
  if (source === 'stability') {
    return `${objectSelectionScoreLabel(source)} ${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  }
  return `${objectSelectionScoreLabel(source)} ${score.toFixed(2)}`;
}

function formatPromptContainment(value: number | undefined): string {
  return value == null
    ? 'prompt match not measured'
    : `prompt match ${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatPromptDiagnostics(
  diagnostics:
    | {
        anchoredCoverage: number;
        componentCount: number;
        positiveAnchorSupport?: Array<{ coveredFraction: number }>;
      }
    | undefined,
): string | null {
  if (!diagnostics) return null;
  const anchorSupport = diagnostics.positiveAnchorSupport?.length
    ? Math.min(...diagnostics.positiveAnchorSupport.map(({ coveredFraction }) => coveredFraction))
    : null;
  const anchorSummary =
    anchorSupport == null
      ? ''
      : ` · include support ${Math.round(Math.max(0, Math.min(1, anchorSupport)) * 100)}%`;
  return `target evidence ${Math.round(Math.max(0, Math.min(1, diagnostics.anchoredCoverage)) * 100)}% anchored · ${diagnostics.componentCount} connected region${diagnostics.componentCount === 1 ? '' : 's'}${anchorSummary}`;
}

function formatPersistedMaskScore(provenance: {
  confidence?: number;
  score?: number;
  scoreSource?: Parameters<typeof objectSelectionScoreLabel>[0];
}): string {
  if (provenance.score !== undefined) {
    return formatObjectSelectionScore(provenance.score, provenance.scoreSource);
  }
  if (provenance.confidence !== undefined) {
    return `mask score ${Math.round(Math.max(0, Math.min(1, provenance.confidence)) * 100)}%`;
  }
  return 'mask score not calibrated';
}

const METHOD_GUIDANCE: Record<
  RemovalMethod,
  { title: string; description: string; bestFor: string; tradeoff: string }
> = {
  quick: {
    title: 'Fast cutout',
    description: 'Instant local masking with no model download.',
    bestFor: 'Flat, studio, product, and colour-consistent backgrounds.',
    tradeoff: 'Natural scenes may need AI Balanced or a short brush cleanup.',
  },
  'ai-balanced': {
    title: 'Auto cutout',
    description: 'General-purpose subject detection with automatic low-memory fallback.',
    bestFor: 'People, pets, vehicles, products, and everyday photos.',
    tradeoff: 'Install enhanced Balanced for the strongest results on varied systems.',
  },
  'ai-quality': {
    title: 'High-quality cutout',
    description: 'BiRefNet Lite preserves difficult boundaries and fine structure.',
    bestFor: 'Hair, fur, foliage, thin objects, and visually complex scenes.',
    tradeoff: 'Uses more memory and is slower than the other modes.',
  },
  portrait: {
    title: 'Portrait matting (MODNet)',
    description:
      'Portrait-specific matting for people in photographs. Produces fractional alpha (soft strands, ' +
      'translucent cloth edges) at a 512-edge reference resolution.',
    bestFor: 'Headshots and people photos where hair and clothing edges matter.',
    tradeoff:
      'Not a general object segmenter: it may matte more than one person in frame. Use Object Selection ' +
      'or Select subject first when you need one specific person, then refine.',
  },
};

const PROMPTED_MODEL_OPTIONS = {
  'mobile-sam': {
    label: 'Faster local model',
    detail: 'MobileSAM · about 45 MB · lower working set',
    ids: [MOBILE_SAM_ENCODER_ID, MOBILE_SAM_DECODER_ID] as const,
  },
  sam2: {
    label: 'Higher-detail local model',
    detail: 'SAM2 Tiny · about 155 MB · more memory and detail',
    ids: ['sam2-hiera-tiny-encoder', 'sam2-hiera-tiny-decoder'] as const,
  },
  'efficient-sam-ti': {
    label: 'Lightweight experimental model',
    detail: 'EfficientSAM-Ti · about 41 MB · benchmark adapter, explicit only',
    ids: ['efficient-sam-ti-encoder', 'efficient-sam-ti-decoder'] as const,
  },
} as const;
type PromptedModelOption = keyof typeof PROMPTED_MODEL_OPTIONS;
type PromptedModelState = 'checking' | 'missing' | 'partial' | 'downloading' | 'ready' | 'error';

const INITIAL_PROMPTED_MODEL_STATES: Record<PromptedModelOption, PromptedModelState> = {
  'mobile-sam': 'checking',
  sam2: 'checking',
  'efficient-sam-ti': 'checking',
};

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    state,
    applySam2Segmentation,
    cancelSam2Segmentation,
    selectSam2Candidate,
    reviewSam2Candidate = () => {},
    promptedProviderPreference = 'auto',
    setPromptedProviderPreference = () => {},
    removeBackgroundWithOptions,
    cancelBackgroundRemoval,
    applyBackgroundRemovalPreview,
    cancelBackgroundRemovalPreview,
    updateDoc,
    announce,
    setAreaSelection,
    setShowOriginalBg,
    setMaskPreviewMode,
    setTool,
    setRefineMaskOptions,
    refineHairEdges,
    startTrimapEdit,
    applyTrimapMatting,
    setTrimapEditOptions,
    getTrimapData,
  } = useEditor();
  const selectedNode = nodes[0] as ShapeNode | undefined;
  const node = selectedNode?.paintRefs?.length
    ? {
        ...selectedNode,
        fills: resolveNodePaints({ paintRefs: selectedNode.paintRefs }, state.document),
      }
    : selectedNode;
  const imageFill = node?.fills?.find((fill) => fill.type === 'image')?.image;
  const imageAsset = imageFill?.assetId ? state.document.assets?.[imageFill.assetId] : undefined;
  const previewSource = imageAsset?.dataUrl ?? (node ? imageShapeSrc(node) : '');
  const previewSourceWidth =
    imageFill?.imageWidth ??
    imageAsset?.naturalWidth ??
    (node?.shape?.kind === 'rect' ? node.shape.w : 0);
  const previewSourceHeight =
    imageFill?.imageHeight ??
    imageAsset?.naturalHeight ??
    (node?.shape?.kind === 'rect' ? node.shape.h : 0);
  const decontaminateId = useId();
  const hasMask = Boolean(
    node && (isImageShape(node) || node.mask?.rasterMask || node.backgroundRemoval),
  );
  const rasterMask = node?.mask?.rasterMask;
  const previewSession =
    node && state.backgroundRemovalPreviewSession?.nodeId === node.id
      ? state.backgroundRemovalPreviewSession
      : null;
  const maskProvenance = rasterMask?.provenance ?? node?.backgroundRemoval;
  const eligible = hasMask;
  const objectSelection =
    node && state.objectSelectionSession?.nodeId === node.id ? state.objectSelectionSession : null;
  const selectedObjectSelectionCandidate = objectSelection
    ? objectSelection.candidates[objectSelection.selectedCandidate]
    : undefined;
  const objectSelectionNeedsRefinement =
    selectedObjectSelectionCandidate?.promptDiagnostics?.requiresRefinement === true;
  const objectSelectionReviewKey = objectSelection
    ? objectSelectionCandidateReviewKey(objectSelection, objectSelection.selectedCandidate)
    : null;
  const objectSelectionReviewed =
    objectSelectionReviewKey !== null &&
    objectSelection?.reviewedCandidateKey === objectSelectionReviewKey;

  const [method, setMethod] = useState<RemovalMethod>(
    (maskProvenance as { method?: RemovalMethod })?.method ?? 'quick',
  );
  const [localPending, setPending] = useState(false);
  const operation =
    state.backgroundRemovalOperation?.nodeId === node?.id ? state.backgroundRemovalOperation : null;
  const pending = localPending || Boolean(operation);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [enhancedBalancedAvailable, setEnhancedBalancedAvailable] = useState(false);
  const [maskEditorOpen, setMaskEditorOpen] = useState(
    () =>
      state.selection[0] === node?.id &&
      (state.tool === 'refineMask' || state.tool === 'trimapEdit'),
  );
  const [feather, setFeather] = useState((maskProvenance as { feather?: number })?.feather ?? 0.5);
  const [decontaminate, setDecontaminate] = useState(
    (maskProvenance as { decontaminate?: boolean })?.decontaminate ?? false,
  );
  useEffect(() => {
    setMethod(maskProvenance?.method ?? 'quick');
    setFeather((maskProvenance as { feather?: number })?.feather ?? 0.5);
    setDecontaminate(maskProvenance?.decontaminate ?? false);
    setError(null);
  }, [node?.id, maskProvenance]);

  const [modelState, setModelState] = useState<'unavailable' | 'downloading' | 'ready' | 'error'>(
    'unavailable',
  );
  const [objectSelectionModelState, setObjectSelectionModelState] =
    useState<PromptedModelState>('checking');
  const [promptedModelStates, setPromptedModelStates] = useState<
    Record<PromptedModelOption, PromptedModelState>
  >(INITIAL_PROMPTED_MODEL_STATES);
  const [objectSelectionDownloadProgress, setObjectSelectionDownloadProgress] = useState<
    number | null
  >(null);
  const [objectSelectionError, setObjectSelectionError] = useState<string | null>(null);
  const [objectSelectionDownloadProvider, setObjectSelectionDownloadProvider] =
    useState<PromptedModelOption | null>(null);
  const objectSelectionDownloadAbortRef = useRef<AbortController | null>(null);
  const [objectSelectionPromptMode, setObjectSelectionPromptMode] =
    useState<Sam2PromptMode>('point');
  const [objectSelectionPromptPolarity, setObjectSelectionPromptPolarity] =
    useState<Sam2PromptPolarity>('include');
  const [objectSelectionCombination, setObjectSelectionCombination] =
    useState<AreaSelectionOperation>('replace');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [hasGpuAccel, setHasGpuAccel] = useState(false);
  const [wasmModelSafe, setWasmModelSafe] = useState(true);

  const showingOriginal = Boolean(node && state.showOriginalBgNodeId === node.id);
  const refiningMask = Boolean(
    node && state.tool === 'refineMask' && state.selection[0] === node.id,
  );
  const editingTrimap = Boolean(
    node && state.tool === 'trimapEdit' && state.selection[0] === node.id,
  );
  const { brushSize, hardness } = state.refineMaskOptions ?? { brushSize: 20, hardness: 0.8 };
  const refineMode = state.refineMaskOptions?.mode ?? 'add';
  const clipToSelection = state.refineMaskOptions?.clipToSelection ?? false;
  // Most imported and segmented masks are binary. Start with the spatial
  // unknown-band solver so Refine edges cannot silently do nothing; Guided
  // remains available for masks that already carry soft coverage.
  const refineMethod = state.refineMaskOptions?.method ?? 'closed-form';
  const refineRadius = state.refineMaskOptions?.radius ?? 4;
  const refineBandRadius = state.refineMaskOptions?.bandRadius ?? refineRadius;
  const trimapPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const editingTrimapNodeId = node && editingTrimap ? node.id : null;
  useEffect(() => {
    if (!editingTrimapNodeId) return;
    const resolveColor = (
      value: string,
      fallback: [number, number, number],
    ): [number, number, number] => {
      try {
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const probeCtx = probe.getContext('2d');
        if (!probeCtx) return fallback;
        probeCtx.fillStyle = value;
        probeCtx.fillRect(0, 0, 1, 1);
        const data = probeCtx.getImageData(0, 0, 1, 1).data;
        return [data[0] ?? fallback[0], data[1] ?? fallback[1], data[2] ?? fallback[2]];
      } catch {
        return fallback;
      }
    };
    const draw = () => {
      const entry = getTrimapData(editingTrimapNodeId);
      const canvas = trimapPreviewRef.current;
      if (!entry || !canvas || entry.width <= 0 || entry.height <= 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const style = getComputedStyle(canvas);
      const fg = resolveColor(
        style.getPropertyValue('--trimap-fg').trim() || '#4ade80',
        [74, 222, 128],
      );
      const bg = resolveColor(
        style.getPropertyValue('--trimap-bg').trim() || '#64748b',
        [100, 116, 139],
      );
      const unknown = resolveColor(
        style.getPropertyValue('--trimap-unknown').trim() || '#fbbf24',
        [251, 191, 36],
      );
      // Categorical rendering: unknown is its own colour, never a 50% alpha.
      const pixels = new Uint8ClampedArray(entry.width * entry.height * 4);
      for (let i = 0; i < entry.data.length; i += 1) {
        const value = entry.data[i]!;
        const color = value >= 245 ? fg : value <= 10 ? bg : unknown;
        const offset = i * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
      const offscreen = document.createElement('canvas');
      offscreen.width = entry.width;
      offscreen.height = entry.height;
      offscreen
        .getContext('2d')
        ?.putImageData(new ImageData(pixels, entry.width, entry.height), 0, 0);
      canvas.width = 192;
      canvas.height = Math.max(48, Math.round((192 * entry.height) / entry.width));
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    };
    draw();
    const timer = window.setInterval(draw, 250);
    return () => window.clearInterval(timer);
  }, [editingTrimapNodeId, getTrimapData]);
  const trimapOpts = state.trimapEditOptions ?? {
    brushSize: 20,
    hardness: 0.8,
    penMode: 'unknown' as const,
  };

  const requiredModelId = workerModelIdForMethod(method);
  const imageMaxDim = node?.shape?.kind === 'rect' ? Math.max(node.shape.w, node.shape.h) : 0;
  const previewDownscaleActive = method !== 'quick' && imageMaxDim > DEFAULT_PREVIEW_MAX_DIMENSION;
  const methodGuidance = METHOD_GUIDANCE[method];

  const startObjectSelection = useCallback(() => {
    if (!node) return;
    setTool('sam2Segment');
    announce(
      'Object Selection active. Prompt polarity controls new points; Shift temporarily excludes. Use two taps or a drag for a box hint.',
    );
  }, [announce, node, setTool]);

  const configureObjectSelectionTool = useCallback(
    (mode: Sam2PromptMode, polarity: Sam2PromptPolarity) => {
      const tool = getToolManager().getTool<Sam2SegmentationTool>('sam2Segment');
      tool?.setPromptMode(mode);
      tool?.setPromptPolarity(polarity);
    },
    [],
  );

  useEffect(() => {
    if (state.tool !== 'sam2Segment') return;
    configureObjectSelectionTool(objectSelectionPromptMode, objectSelectionPromptPolarity);
  }, [
    configureObjectSelectionTool,
    objectSelectionPromptMode,
    objectSelectionPromptPolarity,
    state.tool,
  ]);

  const handleObjectSelectionPromptMode = useCallback(
    (value: string) => {
      const mode = value as Sam2PromptMode;
      setObjectSelectionPromptMode(mode);
      configureObjectSelectionTool(mode, objectSelectionPromptPolarity);
      announce(
        mode === 'box'
          ? 'Box hint mode. Tap two corners or drag a box; the box is a model hint, not a hard crop.'
          : 'Point prompt mode. Click to add a point; Shift temporarily excludes the clicked region.',
      );
    },
    [announce, configureObjectSelectionTool, objectSelectionPromptPolarity],
  );

  const handleObjectSelectionPromptPolarity = useCallback(
    (value: string) => {
      const polarity = value as Sam2PromptPolarity;
      setObjectSelectionPromptPolarity(polarity);
      configureObjectSelectionTool(objectSelectionPromptMode, polarity);
      announce(
        polarity === 'include'
          ? 'New point prompts will include the clicked region.'
          : 'New point prompts will exclude the clicked region.',
      );
    },
    [announce, configureObjectSelectionTool, objectSelectionPromptMode],
  );

  const handleObjectSelectionProvider = useCallback(
    (value: string) => {
      const preference = value as PromptedProviderPreference;
      setPromptedProviderPreference(preference);
      announce(
        preference === 'auto'
          ? 'Object Selection will choose the best validated local provider that fits the image and runtime.'
          : preference === MOBILE_SAM_PROVIDER_ID
            ? 'Faster local Object Selection chosen. MobileSAM is experimental; review candidate masks before applying.'
            : preference === EFFICIENT_SAM_PROVIDER_ID
              ? 'EfficientSAM-Ti chosen for benchmarking. It is experimental, has no mask-refinement prompts, and is never selected automatically.'
              : 'Higher-detail local Object Selection chosen. The model will not be replaced silently if it cannot run.',
      );
    },
    [announce, setPromptedProviderPreference],
  );

  const applyObjectSelectionMask = useCallback(() => {
    if (!node || !objectSelection) return;
    if (objectSelectionNeedsRefinement) {
      announce(
        'The highlighted selection reaches an unsupported image edge. Add an include point on that extent or draw a box around the full target before applying it.',
      );
      return;
    }
    if (!objectSelectionReviewed) {
      announce('Review the highlighted Object Selection target before applying it.');
      return;
    }
    void applySam2Segmentation({
      nodeId: node.id,
      prompts: {
        points: objectSelection.points,
        box: objectSelection.box ?? undefined,
      },
      sourcePrompts: objectSelection.sourcePrompts,
      operation: 'mask',
      candidateIndex: objectSelection.selectedCandidate,
    });
  }, [
    announce,
    applySam2Segmentation,
    node,
    objectSelection,
    objectSelectionNeedsRefinement,
    objectSelectionReviewed,
  ]);

  const applyObjectSelectionAsSelection = useCallback(async () => {
    if (!node || !objectSelection) return;
    if (objectSelectionNeedsRefinement) {
      announce(
        'The highlighted selection reaches an unsupported image edge. Add an include point on that extent or draw a box around the full target before using it.',
      );
      return;
    }
    if (!objectSelectionReviewed) {
      announce('Review the highlighted Object Selection target before applying it.');
      return;
    }
    const commitCombinedSelection = setAreaSelection;
    if (objectSelectionCombination !== 'replace' && !commitCombinedSelection) {
      announce('Pixel selection combination is unavailable in this editor surface.');
      return;
    }
    const baseline = state.areaSelection ?? null;
    const result = await applySam2Segmentation({
      nodeId: node.id,
      prompts: {
        points: objectSelection.points,
        box: objectSelection.box ?? undefined,
      },
      sourcePrompts: objectSelection.sourcePrompts,
      operation: 'selection',
      candidateIndex: objectSelection.selectedCandidate,
    });
    if (!result || objectSelectionCombination === 'replace') return;
    if (!commitCombinedSelection) return;
    const incoming = areaSelectionFromMaskCoverage(
      state.document,
      node.id,
      result.mask,
      result.width,
      result.height,
      'source-image-pixels',
    );
    if (!incoming) {
      commitCombinedSelection(baseline);
      announce('The reviewed mask could not be combined with the current selection.');
      return;
    }
    const combined = combineAreaSelections(baseline, incoming, objectSelectionCombination);
    commitCombinedSelection(combined);
    announce(
      combined
        ? `Reviewed object selection ${objectSelectionCombination}.`
        : 'Reviewed object selection needs an existing selection for this combination.',
    );
  }, [
    announce,
    applySam2Segmentation,
    node,
    objectSelection,
    objectSelectionNeedsRefinement,
    objectSelectionReviewed,
    objectSelectionCombination,
    setAreaSelection,
    state.areaSelection,
    state.document,
  ]);

  const retryObjectSelection = useCallback(() => {
    if (!node || !objectSelection) return;
    void applySam2Segmentation({
      nodeId: node.id,
      prompts: {
        points: objectSelection.points,
        box: objectSelection.box ?? undefined,
      },
      sourcePrompts: objectSelection.sourcePrompts,
      operation: 'preview',
    });
  }, [applySam2Segmentation, node, objectSelection]);

  const refreshModelStatus = useCallback(async () => {
    const loader = await getModelLoaderReady();
    setModelState(loader.getState());
    if (method === 'quick' || !requiredModelId) {
      setAiAvailable(true);
      setEnhancedBalancedAvailable(await loader.isModelAvailable('isnet-general-use'));
      return;
    }
    setAiAvailable(await loader.isModelAvailable(requiredModelId));
    setEnhancedBalancedAvailable(await loader.isModelAvailable('isnet-general-use'));
  }, [method, requiredModelId]);

  const refreshObjectSelectionModelStatus = useCallback(async () => {
    const loader = await getModelLoaderReady();
    const entries = await Promise.all(
      (Object.keys(PROMPTED_MODEL_OPTIONS) as PromptedModelOption[]).map(async (providerId) => {
        const availability = await Promise.all(
          PROMPTED_MODEL_OPTIONS[providerId].ids.map((modelId) => loader.isModelAvailable(modelId)),
        );
        return {
          providerId,
          state: availability.every(Boolean)
            ? ('ready' as const)
            : availability.some(Boolean)
              ? ('partial' as const)
              : ('missing' as const),
        };
      }),
    );
    for (const entry of entries) {
      setPromptedModelStates((previous) => ({ ...previous, [entry.providerId]: entry.state }));
    }
    const hasReady = entries.some((entry) => entry.state === 'ready');
    const hasPartial = entries.some((entry) => entry.state === 'partial');
    setObjectSelectionModelState(hasReady ? 'ready' : hasPartial ? 'partial' : 'missing');
  }, []);

  useEffect(() => {
    if (!eligible) return;
    void refreshModelStatus();
    let unsub: (() => void) | undefined;
    void getModelLoaderReady().then((loader) => {
      unsub = loader.subscribe(() => {
        void refreshModelStatus();
      });
    });
    return () => unsub?.();
  }, [refreshModelStatus, eligible]);

  useEffect(() => {
    if (!eligible) return;
    void refreshObjectSelectionModelStatus();
    let unsub: (() => void) | undefined;
    void getModelLoaderReady().then((loader) => {
      unsub = loader.subscribe(() => {
        void refreshObjectSelectionModelStatus();
      });
    });
    return () => {
      unsub?.();
      objectSelectionDownloadAbortRef.current?.abort();
    };
  }, [eligible, refreshObjectSelectionModelStatus]);

  useEffect(() => {
    getEnvironmentCapabilities().then((caps) => {
      // Browser-only GPU signal. Native ONNX inference in the desktop app
      // runs on the CPU, and a native GPU is not used by these preview
      // kernels; `aiAvailable` separately suppresses WASM warnings when the
      // native provider can run the model.
      setHasGpuAccel(caps.hasWebGPU || caps.hasWebGL);
    });
  }, []);

  useEffect(() => {
    if (method !== 'quick' && requiredModelId) {
      isWasmModelSafe(requiredModelId).then(setWasmModelSafe);
    } else {
      setWasmModelSafe(true);
    }
  }, [method, requiredModelId]);

  useEffect(() => {
    if (pending) {
      setElapsedMs(0);
      const start = operation?.startedAt ?? Date.now();
      elapsedRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - start);
      }, 250);
    } else if (elapsedRef.current !== null) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
    return () => {
      if (elapsedRef.current !== null) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [pending, operation?.startedAt]);

  if (isCapabilityRestricted('inference')) return null;
  if (!eligible || !node) return null;

  const handleApply = async () => {
    // Re-check freshly rather than trusting `aiAvailable` state: it's set
    // asynchronously by the model-status effect keyed on `method`, so
    // switching the dropdown and clicking Apply before that effect resolves
    // could otherwise let a stale "available" reading from a previously
    // selected method through, silently attempting removal with no model.
    if (method !== 'quick' && requiredModelId) {
      const loader = await getModelLoaderReady();
      const stillAvailable = await loader.isModelAvailable(requiredModelId);
      setAiAvailable(stillAvailable);
      if (!stillAvailable) {
        announce('Download the AI model first, or switch to Quick mode.');
        setDownloadModelId(requiredModelId);
        setShowDownloadDialog(true);
        return;
      }
    }
    setError(null);
    setPending(true);
    try {
      await removeBackgroundWithOptions(method, feather, decontaminate);
    } catch (e) {
      const message = normalizeErrorMessage(e, 'Background removal failed');
      setError(message);
      if (message !== 'Cancelled') {
        announce(message);
      }
    } finally {
      setPending(false);
    }
  };

  const handleCancel = () => {
    cancelBackgroundRemoval();
    setPending(false);
    setError('Cancelled');
  };

  const handleReset = () => {
    updateDoc((document) => {
      const withoutNativeMask = removeRasterMaskFromNode(document, node.id);
      const current = withoutNativeMask.nodes[node.id] as ShapeNode | undefined;
      if (!current?.backgroundRemoval) return withoutNativeMask;
      const { backgroundRemoval: _, ...rest } = current;
      return {
        ...withoutNativeMask,
        nodes: { ...withoutNativeMask.nodes, [node.id]: rest as ShapeNode },
      };
    });
    announce('Background removal reset');
  };

  const handleDownload = (modelId = requiredModelId) => {
    // Show a warning before downloading AI Quality on environments without GPU
    if (method === 'ai-quality' && !hasGpuAccel && !aiAvailable) {
      announce(
        'This model requires significant memory. Download it now, but inference may fail without GPU acceleration on this device.',
      );
    }
    setDownloadModelId(modelId);
    setShowDownloadDialog(true);
  };

  const installObjectSelectionModels = useCallback(
    async (providerId: PromptedModelOption) => {
      objectSelectionDownloadAbortRef.current?.abort();
      const controller = new AbortController();
      objectSelectionDownloadAbortRef.current = controller;
      setObjectSelectionDownloadProvider(providerId);
      setPromptedModelStates((previous) => ({ ...previous, [providerId]: 'downloading' }));
      setObjectSelectionError(null);
      setObjectSelectionDownloadProgress(0);
      const modelIds = PROMPTED_MODEL_OPTIONS[providerId].ids;
      try {
        const loader = await getModelLoaderReady();
        for (const [index, modelId] of modelIds.entries()) {
          if (await loader.isModelAvailable(modelId)) {
            setObjectSelectionDownloadProgress(Math.round(((index + 1) / modelIds.length) * 100));
            continue;
          }
          await loader.downloadModel(
            modelId,
            (loaded, total) => {
              const partProgress = total > 0 ? loaded / total : 0;
              setObjectSelectionDownloadProgress(
                Math.round(((index + partProgress) / modelIds.length) * 100),
              );
            },
            controller.signal,
          );
        }
        setObjectSelectionDownloadProgress(100);
        setPromptedModelStates((previous) => ({ ...previous, [providerId]: 'ready' }));
        await refreshObjectSelectionModelStatus();
      } catch (error) {
        if (!controller.signal.aborted) {
          setPromptedModelStates((previous) => ({ ...previous, [providerId]: 'error' }));
          setObjectSelectionError(normalizeObjectSelectionDownloadError(error));
        }
      } finally {
        if (objectSelectionDownloadAbortRef.current === controller) {
          objectSelectionDownloadAbortRef.current = null;
          setObjectSelectionDownloadProvider(null);
        }
        if (!controller.signal.aborted) setObjectSelectionDownloadProgress(null);
      }
    },
    [refreshObjectSelectionModelStatus],
  );

  const cancelObjectSelectionModelDownload = useCallback(() => {
    objectSelectionDownloadAbortRef.current?.abort();
    objectSelectionDownloadAbortRef.current = null;
    setObjectSelectionDownloadProvider(null);
    setObjectSelectionDownloadProgress(null);
    void refreshObjectSelectionModelStatus();
  }, [refreshObjectSelectionModelStatus]);

  const handleTogglePreview = () => {
    setShowOriginalBg(showingOriginal ? null : node.id);
    announce(
      showingOriginal
        ? 'Showing masked result'
        : 'Showing original image without background removal',
    );
  };

  const handleRefineMask = () => {
    setMaskEditorOpen(true);
    setMaskPreviewMode('checkerboard');
    setTool('refineMask');
    announce('Refine mask: 1 add, 2 subtract, 3 restore, Alt paints subtract; Escape to finish');
  };

  const handleRefineHair = () => {
    void refineHairEdges({
      method: refineMethod,
      radius: refineRadius,
      bandRadius: refineBandRadius,
    });
  };

  const handleEditTrimap = () => {
    setMaskEditorOpen(true);
    startTrimapEdit();
  };

  const handleApplyTrimap = () => {
    void applyTrimapMatting();
  };

  const handleDoneMaskEditing = () => {
    setTool('select');
    setMaskPreviewMode('none');
    setMaskEditorOpen(false);
    announce('Mask editing finished');
  };

  return (
    <>
      {eligible && (
        <DisclosureSection title="Object Selection" defaultExpanded={Boolean(objectSelection)}>
          <div className="insp-field-group">
            <p className="insp-field__hint">
              Select an object on the image, then refine it with more points or a box. The preview
              is temporary until you use it as a selection or apply it as a mask.
            </p>
            <TextDiscoveryPanel
              source={node ? previewSource || null : null}
              onSegmentBox={(box) => {
                if (!node) return;
                const sourceNode = state.document.nodes[node.id];
                const mapper =
                  sourceNode && previewSourceWidth > 0 && previewSourceHeight > 0
                    ? prepareImageMaskMapper({
                        document: state.document,
                        node: sourceNode,
                        sourceWidth: previewSourceWidth,
                        sourceHeight: previewSourceHeight,
                      })
                    : null;
                const worldPrompts = mapSourceSam2PromptsToWorld(
                  { box },
                  mapper,
                  previewSourceWidth,
                  previewSourceHeight,
                );
                if (!worldPrompts?.box) {
                  announce(
                    'The detected region could not be mapped to the visible image placement. Run discovery again.',
                  );
                  return;
                }
                void applySam2Segmentation({
                  nodeId: node.id,
                  prompts: worldPrompts,
                  sourcePrompts: { box },
                  operation: 'preview',
                });
              }}
              announce={announce}
              disabled={!node}
            />
            <FieldRow label="Prompt input">
              <Select
                label="Object Selection prompt input"
                value={objectSelectionPromptMode}
                options={[
                  { value: 'point', label: 'Points — include or exclude regions' },
                  { value: 'box', label: 'Box hint — two taps or drag' },
                ]}
                onChange={handleObjectSelectionPromptMode}
              />
            </FieldRow>
            <FieldRow label="Prompt polarity" wrapLabel>
              <Select
                label="Object Selection prompt polarity"
                value={objectSelectionPromptPolarity}
                options={[
                  { value: 'include', label: 'Include new points' },
                  { value: 'exclude', label: 'Exclude new points' },
                ]}
                onChange={handleObjectSelectionPromptPolarity}
              />
            </FieldRow>
            <FieldRow label="Selection combination" wrapLabel>
              <Select
                label="Object Selection output combination"
                value={objectSelectionCombination}
                options={[
                  { value: 'replace', label: 'Replace current selection' },
                  { value: 'add', label: 'Add to current selection' },
                  { value: 'subtract', label: 'Subtract from current selection' },
                  { value: 'intersect', label: 'Intersect current selection' },
                ]}
                onChange={(value) => setObjectSelectionCombination(value as AreaSelectionOperation)}
              />
            </FieldRow>
            <p className="insp-field__hint">
              Polarity labels a new model prompt. Combination changes only{' '}
              <strong>Use as selection</strong>; <strong>Apply as mask</strong> always creates the
              reviewed mask as a document mask.
            </p>
            <FieldRow label="Model preference" wrapLabel>
              <Select
                label="Object Selection model preference"
                value={promptedProviderPreference}
                options={[
                  {
                    value: 'auto',
                    label: 'Auto — best validated available',
                    description:
                      'Routes by measured quality, runtime support, memory, and installed models.',
                  },
                  {
                    value: MOBILE_SAM_PROVIDER_ID,
                    label: 'Faster local — MobileSAM',
                    description: 'Experimental, lower working set; review candidates carefully.',
                  },
                  {
                    value: SAM2_PROVIDER_ID,
                    label: 'Higher detail — SAM2 Tiny',
                    description: 'Larger local model with the current higher-detail workflow.',
                  },
                  {
                    value: EFFICIENT_SAM_PROVIDER_ID,
                    label: 'Experimental — EfficientSAM-Ti',
                    description:
                      'Benchmark adapter; no mask refinement prompts and never auto-selected.',
                  },
                ]}
                onChange={handleObjectSelectionProvider}
              />
            </FieldRow>
            <button type="button" className="insp-btn-sm" onClick={startObjectSelection}>
              {objectSelection ? 'Continue Object Selection' : 'Select Object'}
            </button>
            <p className="insp-field__hint">
              Object Selection stays local and chooses between installed prompt models. Explicit
              choices are honored without silent fallback; EfficientSAM-Ti is an experimental
              benchmark adapter. No image leaves this device.
            </p>
            <fieldset className="insp-field-group" aria-label="Object Selection model choices">
              {(Object.keys(PROMPTED_MODEL_OPTIONS) as PromptedModelOption[]).map((providerId) => {
                const option = PROMPTED_MODEL_OPTIONS[providerId];
                const providerState = promptedModelStates[providerId];
                const isDownloading = objectSelectionDownloadProvider === providerId;
                return (
                  <div className="insp-actions" key={providerId}>
                    <Button
                      type="button"
                      variant={providerId === 'mobile-sam' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => void installObjectSelectionModels(providerId)}
                      disabled={objectSelectionDownloadProvider !== null}
                      aria-label={
                        providerId === 'mobile-sam'
                          ? 'Install Object Selection model'
                          : 'Install higher-detail Object Selection model'
                      }
                    >
                      {providerState === 'ready'
                        ? `${option.label} installed`
                        : providerState === 'error' || providerState === 'partial'
                          ? `Retry ${option.label}`
                          : `Install ${option.label} (${option.detail.split(' · ')[1]})`}
                    </Button>
                    <span className="insp-field__hint">{option.detail}</span>
                    {isDownloading && (
                      <span className="insp-field__hint" role="status" aria-live="polite">
                        Downloading… {objectSelectionDownloadProgress ?? 0}%
                      </span>
                    )}
                  </div>
                );
              })}
              {objectSelectionError && (
                <p className="insp-hint insp-hint--error" role="alert">
                  {objectSelectionError}
                </p>
              )}
            </fieldset>
            {objectSelectionDownloadProvider && (
              <div className="insp-actions">
                <span className="insp-field__hint" role="status" aria-live="polite">
                  Installing {PROMPTED_MODEL_OPTIONS[objectSelectionDownloadProvider].label}…{' '}
                  {objectSelectionDownloadProgress ?? 0}%
                </span>
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={cancelObjectSelectionModelDownload}
                >
                  Cancel
                </button>
              </div>
            )}
            {objectSelectionModelState === 'ready' && (
              <span className="insp-field__hint" role="status">
                Object Selection model ready · local processing · Auto routes by measured runtime;
                explicit choices are honored without silent fallback
              </span>
            )}
            {objectSelection && (
              <>
                <span className="insp-field__hint" role="status" aria-live="polite">
                  {objectSelection.slow
                    ? 'Taking longer than expected… Cancel remains available.'
                    : objectSelection.status === 'ready'
                      ? `Preview ready · ${formatObjectSelectionScore(objectSelection.confidence, objectSelection.confidenceSource)} · ${formatPromptContainment(objectSelection.candidates[objectSelection.selectedCandidate]?.promptContainment)} · ${objectSelection.candidates.length} candidate mask${objectSelection.candidates.length === 1 ? '' : 's'}${objectSelection.rejectedCandidateCount ? ` · ${objectSelection.rejectedCandidateCount} rejected by prompt checks` : ''}`
                      : objectSelection.status === 'error'
                        ? 'Object selection failed — your prompts are still available.'
                        : objectSelection.status === 'drawing'
                          ? 'Drawing prompt…'
                          : objectSelection.status === 'encoding'
                            ? 'Encoding image…'
                            : objectSelection.status === 'decoding'
                              ? 'Calculating candidate masks…'
                              : 'Preparing object selection…'}
                </span>
                {(() => {
                  const candidate = objectSelection.candidates[objectSelection.selectedCandidate];
                  const diagnostics = candidate?.promptDiagnostics;
                  const summary = formatPromptDiagnostics(diagnostics);
                  if (!summary) return null;
                  return (
                    <span className="insp-field__hint" role="status">
                      {summary}
                    </span>
                  );
                })()}
                {objectSelection.candidates[
                  objectSelection.selectedCandidate
                ]?.promptDiagnostics?.warnings.map((warning) => (
                  <p className="insp-field__hint insp-hint--warn" role="status" key={warning}>
                    {warning}
                  </p>
                ))}
                {objectSelection.status === 'error' && objectSelection.error && (
                  <p className="insp-field__hint insp-hint--error" role="alert">
                    {objectSelection.error.message}
                  </p>
                )}
                {objectSelection.status === 'ready' && selectedObjectSelectionCandidate && (
                  <>
                    <label className="insp-check" htmlFor="object-selection-review-confirmation">
                      <input
                        id="object-selection-review-confirmation"
                        className="insp-checkbox"
                        type="checkbox"
                        checked={objectSelectionReviewed}
                        disabled={
                          objectSelectionReviewKey === null || objectSelectionNeedsRefinement
                        }
                        onChange={(event) => reviewSam2Candidate(event.currentTarget.checked)}
                      />
                      I reviewed the highlighted target before applying
                    </label>
                    {!objectSelectionReviewed && (
                      <p className="insp-field__hint" role="status" aria-live="polite">
                        {objectSelectionNeedsRefinement
                          ? 'Refine the highlighted edge extent with another include point or a box before applying it.'
                          : objectSelectionReviewKey === null
                            ? 'This preview cannot be verified safely. Create a new preview before applying it.'
                            : 'Inspect the highlighted overlay, then confirm the target you want to apply.'}
                      </p>
                    )}
                  </>
                )}
                {objectSelection.candidates.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <button
                      type="button"
                      className="insp-btn-sm"
                      aria-label="Previous object-selection candidate"
                      onClick={() =>
                        selectSam2Candidate(
                          (objectSelection.selectedCandidate -
                            1 +
                            objectSelection.candidates.length) %
                            objectSelection.candidates.length,
                        )
                      }
                    >
                      Previous
                    </button>
                    <span className="insp-field__hint" aria-live="polite">
                      Candidate {objectSelection.selectedCandidate + 1} of{' '}
                      {objectSelection.candidates.length}
                    </span>
                    <button
                      type="button"
                      className="insp-btn-sm"
                      aria-label="Next object-selection candidate"
                      onClick={() =>
                        selectSam2Candidate(
                          (objectSelection.selectedCandidate + 1) %
                            objectSelection.candidates.length,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={applyObjectSelectionMask}
                    disabled={
                      objectSelection.status !== 'ready' ||
                      objectSelection.candidates.length === 0 ||
                      objectSelectionNeedsRefinement ||
                      !objectSelectionReviewed
                    }
                  >
                    Apply as mask
                  </button>
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={applyObjectSelectionAsSelection}
                    disabled={
                      objectSelection.status !== 'ready' ||
                      objectSelection.candidates.length === 0 ||
                      objectSelectionNeedsRefinement ||
                      !objectSelectionReviewed
                    }
                  >
                    Use as selection
                  </button>
                  {objectSelection.status === 'error' && (
                    <button type="button" className="insp-btn-sm" onClick={retryObjectSelection}>
                      Retry
                    </button>
                  )}
                  <button type="button" className="insp-btn-sm" onClick={cancelSam2Segmentation}>
                    Clear prompts
                  </button>
                  {objectSelection.status !== 'ready' && objectSelection.status !== 'error' && (
                    <button type="button" className="insp-btn-sm" onClick={cancelSam2Segmentation}>
                      Cancel
                    </button>
                  )}
                </div>
                <p className="insp-field__hint">
                  {objectSelectionPromptMode === 'box'
                    ? 'Box hint mode accepts two taps for opposite corners or a drag. It guides the model and does not hard-clip the output.'
                    : 'Canvas markers use + for include and − for exclude. Tap a marker to remove it, drag a marker to move it, or press Backspace to remove the last one.'}{' '}
                  Clearing prompts also clears the current preview; the image itself is never
                  changed.
                </p>
                <span className="insp-field__hint" data-testid="object-selection-prompt-count">
                  {objectSelection.points.length +
                    (objectSelection.box || objectSelection.draftBox ? 1 : 0)}{' '}
                  prompt
                  {objectSelection.points.length +
                    (objectSelection.box || objectSelection.draftBox ? 1 : 0) ===
                  1
                    ? ''
                    : 's'}
                </span>
              </>
            )}
          </div>
        </DisclosureSection>
      )}
      <DisclosureSection title="Background Removal" sectionId="background-removal">
        <div className="insp-field-group">
          <FieldRow label="Method">
            <Select
              label="Background removal method"
              value={method}
              options={[
                { value: 'quick', label: 'Fast — instant, simple backgrounds' },
                {
                  value: 'ai-balanced',
                  label: `Auto — general photos (AI Balanced)${!aiAvailable ? ' (download required)' : ''}`,
                },
                {
                  value: 'ai-quality',
                  label: `High quality — fine details (AI High Quality)${
                    !aiAvailable ? ' (download required)' : ''
                  }${!wasmModelSafe && !hasGpuAccel && !aiAvailable ? ' — may need GPU' : ''}`,
                },
                {
                  value: 'portrait',
                  label: `Portrait matting — people photos (MODNet)${
                    !aiAvailable ? ' (download required)' : ''
                  }`,
                },
              ]}
              onChange={(v) => setMethod(v as RemovalMethod)}
            />
          </FieldRow>
          <span id="bg-method-desc" className="sr-only">
            Fast uses a local heuristic. Auto uses IS-Net General Use when installed and falls back
            to bundled U²-Net Light. High quality uses BiRefNet Lite where the available provider is
            safe. Portrait uses MODNet, a portrait-specific matting model, and never runs as a
            fallback for other modes.
          </span>

          <section className="insp-nested-panel" aria-label={`${methodGuidance.title} guidance`}>
            <p className="insp-subsection__label">{methodGuidance.title}</p>
            <p className="insp-model-info__desc">{methodGuidance.description}</p>
            <p className="insp-hint">
              <strong>Best for:</strong> {methodGuidance.bestFor}
            </p>
            <p className="insp-hint">{methodGuidance.tradeoff}</p>
            {method === 'quick' && (
              <ol className="insp-hint" aria-label="Quick cutout workflow">
                <li>Create an automatic mask preview.</li>
                <li>Review it on the checkerboard before applying.</li>
                <li>Open Edit mask for brush or trimap corrections.</li>
              </ol>
            )}
          </section>

          {(() => {
            const info = getModelInfo(method);
            if (!info) return null;
            const needsGpuWarn =
              info.gpuRecommended && method === 'ai-quality' && !hasGpuAccel && !aiAvailable;
            return (
              <div className="insp-model-info">
                <p className="insp-hint">
                  {info.quality} &middot; {info.diskSizeDisplay} on disk &middot;{' '}
                  {info.peakRamDisplay} RAM during inference
                </p>
                <p className="insp-model-info__desc">{info.description}</p>
                {needsGpuWarn && (
                  <p className="insp-hint insp-hint--warn" role="status">
                    GPU acceleration recommended for this model. Without it, inference may be slow
                    or fail on some systems.
                  </p>
                )}
                {method === 'ai-quality' &&
                  !wasmModelSafe &&
                  !hasGpuAccel &&
                  !aiAvailable &&
                  !needsGpuWarn && (
                    <p className="insp-hint insp-hint--warn" role="status">
                      This model exceeds the safe WASM memory limit without GPU acceleration. The AI
                      Balanced model will be used as fallback if AI Quality fails. Consider
                      switching to AI Balanced for reliable results.
                    </p>
                  )}
              </div>
            );
          })()}

          {previewDownscaleActive && (
            <p className="insp-hint" aria-live="polite">
              Processing at reduced resolution; full-resolution mask upscaled.
            </p>
          )}

          {method !== 'quick' && !aiAvailable && modelState !== 'downloading' && (
            <div className="insp-actions">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => handleDownload()}
                aria-label="Download AI model for background removal"
              >
                Download AI Model
              </Button>
              <p className="insp-hint">
                Requires a one-time download stored on this device. Manage models in Settings,
                Offline Models.
              </p>
            </div>
          )}

          {method === 'ai-balanced' && aiAvailable && !enhancedBalancedAvailable && (
            <div className="insp-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleDownload('isnet-general-use')}
                aria-label="Download enhanced Balanced model"
              >
                Upgrade Balanced
              </Button>
              <p className="insp-hint">
                Optional 179 MB IS-Net model improves varied people, animals, vehicles, and objects.
                The bundled low-memory model remains available as fallback.
              </p>
            </div>
          )}
          {method !== 'quick' && modelState === 'downloading' && (
            <p className="insp-hint" aria-live="polite">
              Downloading model... Please wait.
            </p>
          )}

          {maskProvenance && (
            <p className="insp-meta-row">
              <span>{formatPersistedMaskScore(maskProvenance)}</span>
              <span className="insp-meta-row__sep" aria-hidden>
                ·
              </span>
              <span>{(maskProvenance as { method?: string }).method ?? 'quick'}</span>
            </p>
          )}

          {maskProvenance &&
            (maskProvenance as { confidence?: number }).confidence !== undefined &&
            ((maskProvenance as { confidence?: number }).confidence ?? 1) < 0.55 && (
              <p className="insp-hint insp-hint--warn" role="status">
                This mask is uncertain. Try AI Balanced or open Edit mask to correct the edges.
              </p>
            )}

          <div className="insp-field">
            <label className="insp-field__label" htmlFor="bg-feather">
              Feather
            </label>
            <div className="insp-field__control">
              <div className="insp-stepper">
                <button
                  type="button"
                  className="insp-stepper__btn"
                  onClick={() => setFeather((v) => Math.max(0, +(v - 0.1).toFixed(1)))}
                  aria-label="Decrease feather"
                >
                  −
                </button>
                <input
                  id="bg-feather"
                  type="number"
                  min={0}
                  max={3}
                  step={0.1}
                  value={feather}
                  aria-label="Feather"
                  className="insp-num__input insp-stepper__input"
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (!Number.isNaN(v)) setFeather(Math.max(0, Math.min(3, v)));
                  }}
                />
                <button
                  type="button"
                  className="insp-stepper__btn"
                  onClick={() => setFeather((v) => Math.min(3, +(v + 0.1).toFixed(1)))}
                  aria-label="Increase feather"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="insp-hint">
            Feather softens the mask boundary. Keep it low for hard objects; increase it slightly
            for soft edges.
          </p>

          <Switch
            id={decontaminateId}
            label="Contract soft edges"
            className="insp-switch"
            checked={decontaminate}
            onChange={(e) => setDecontaminate(e.target.checked)}
          />
          <p className="insp-hint">
            Contracts the semi-transparent mask boundary by about one pixel. This can reduce halos,
            but may remove fine detail; it does not recolour the source.
          </p>

          <div className="insp-actions">
            {pending ? (
              <>
                <span className="insp-hint" aria-live="polite">
                  {operation?.stage === 'decoding'
                    ? 'Reading source image'
                    : operation?.stage === 'processing'
                      ? 'Processing image'
                      : 'Preparing preview'}
                  … {Math.round(elapsedMs / 1000)}s
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  aria-label="Cancel background removal"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleApply()}
                aria-label={
                  maskProvenance ? 'Re-apply background removal' : 'Remove background from image'
                }
              >
                {maskProvenance
                  ? 'Preview new mask'
                  : method === 'quick'
                    ? 'Create quick preview'
                    : 'Create AI preview'}
              </Button>
            )}
          </div>

          {previewSession && (
            <ShineBorder variant="beam" tone="accent">
              <section className="insp-nested-panel" aria-label="Background removal review">
                <p className="insp-subsection__label">Review mask before applying</p>
                <div
                  className="insp-mask-review"
                  style={{
                    backgroundImage:
                      'conic-gradient(var(--color-surface-raised) 25%, var(--color-border-subtle) 0 50%, var(--color-surface-raised) 0 75%, var(--color-border-subtle) 0)',
                    backgroundSize: '16px 16px',
                  }}
                >
                  <BoundedImagePreview
                    source={previewSource}
                    sourceWidth={previewSourceWidth}
                    sourceHeight={previewSourceHeight}
                    alt="Isolated subject preview"
                    className="insp-mask-review__image"
                    maskDataUrl={previewSession.maskDataUrl}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxHeight: 180,
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <p className="insp-hint" role="status">
                  Requested {previewSession.requestedMethod}; generated{' '}
                  {previewSession.actualMethod}
                  {previewSession.modelId ? ` with ${previewSession.modelId}` : ''}
                  {previewSession.modelPrecision
                    ? ` (${previewSession.modelPrecision.toUpperCase()})`
                    : ''}
                  {previewSession.executionProvider
                    ? ` on ${previewSession.executionProvider}`
                    : ''}
                  .
                  {previewSession.precisionFallback && previewSession.precisionFallbackReason
                    ? ` ${previewSession.precisionFallbackReason}`
                    : ''}{' '}
                  Nothing has been added to the document yet.
                </p>
                <div className="insp-field">
                  <span className="insp-field__label">Mask score</span>
                  <div className="insp-field__control">
                    <progress max={1} value={previewSession.confidence} aria-label="Mask score" />
                    <span>{Math.round(previewSession.confidence * 100)}%</span>
                  </div>
                </div>
                <p className="insp-hint">
                  Algorithm score, not a probability of accuracy. Inspect edges before applying.
                </p>
                {previewSession.confidence < 0.55 && (
                  <p className="insp-hint insp-hint--warn" role="status">
                    The subject boundary is uncertain. Cancel and choose AI Balanced, or apply then
                    use Edit mask to correct it.
                  </p>
                )}
                <div className="insp-actions">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={applyBackgroundRemovalPreview}
                  >
                    Apply result
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelBackgroundRemovalPreview}
                  >
                    Cancel preview
                  </Button>
                </div>
              </section>
            </ShineBorder>
          )}

          {maskProvenance && (
            <div className="insp-actions insp-actions--secondary">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                aria-label="Reset background removal to original image"
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (maskEditorOpen) handleDoneMaskEditing();
                  else handleRefineMask();
                }}
                aria-expanded={maskEditorOpen}
                aria-controls="background-mask-editor"
              >
                {maskEditorOpen ? 'Close mask editor' : 'Edit mask'}
              </Button>
              <Button
                type="button"
                variant={showingOriginal ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={showingOriginal}
                onClick={handleTogglePreview}
              >
                {showingOriginal ? 'Showing Original' : 'Show Original'}
              </Button>
            </div>
          )}

          {error && error !== 'Cancelled' && (
            <p className="insp-hint insp-hint--error" role="alert">
              {error}
            </p>
          )}
        </div>

        {maskEditorOpen && maskProvenance && (
          <div className="insp-nested-panel" id="background-mask-editor">
            <p className="insp-subsection__label">Mask editor</p>
            <p className="insp-hint">
              Paint to add the subject. Hold Alt while painting to remove it. Use trimap for
              difficult semi-transparent edges.
            </p>
            <FieldRow label="Preview">
              <Select
                label="Mask preview mode"
                value={state.maskPreviewMode}
                options={[
                  { value: 'checkerboard', label: 'Checkerboard' },
                  { value: 'overlay', label: 'Overlay' },
                  { value: 'black', label: 'Black bg' },
                  { value: 'white', label: 'White bg' },
                  { value: 'mask-only', label: 'Mask only' },
                  { value: 'edge', label: 'Edge detection' },
                  { value: 'none', label: 'None' },
                ]}
                onChange={(v) =>
                  setMaskPreviewMode(v as import('../../../context/types').MaskPreviewMode)
                }
              />
            </FieldRow>
            <div className="insp-actions">
              <Button
                type="button"
                variant={refiningMask ? 'secondary' : 'ghost'}
                size="sm"
                onClick={handleRefineMask}
              >
                Refine Mask
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefineHair}
                aria-label="Refine edges with the selected edge method"
              >
                Refine edges
              </Button>
              <Button
                type="button"
                variant={editingTrimap ? 'secondary' : 'ghost'}
                size="sm"
                onClick={handleEditTrimap}
                aria-label="Edit trimap for difficult edges"
              >
                Edit trimap
              </Button>
            </div>
            <FieldRow label="Brush mode">
              <Select
                label="Brush mode"
                value={refineMode}
                options={[
                  { value: 'add', label: 'Add / reveal' },
                  { value: 'subtract', label: 'Subtract / hide' },
                  { value: 'restore', label: 'Restore original' },
                ]}
                onChange={(v) =>
                  setRefineMaskOptions({ mode: v as 'add' | 'subtract' | 'restore' })
                }
              />
            </FieldRow>
            <FieldRow label="Brush size" htmlFor="bg-refine-brush-range">
              <RangeValueControl
                id="bg-refine-brush"
                label="Brush size"
                value={brushSize}
                min={5}
                max={100}
                unit="px"
                rangeAriaLabel="Brush size (image pixels)"
                onChange={(value) => setRefineMaskOptions({ brushSize: value, hardness })}
              />
            </FieldRow>
            <FieldRow label="Hardness" htmlFor="bg-refine-hardness-range">
              <RangeValueControl
                id="bg-refine-hardness"
                label="Hardness"
                value={hardness}
                min={0}
                max={1}
                step={0.05}
                displayScale={100}
                unit="%"
                rangeAriaLabel="Hardness"
                onChange={(value) => setRefineMaskOptions({ brushSize, hardness: value })}
              />
            </FieldRow>
            <Switch
              className="insp-switch"
              label="Clip strokes to selection"
              checked={clipToSelection}
              onChange={(event) => setRefineMaskOptions({ clipToSelection: event.target.checked })}
            />
            <p className="insp-hint">
              Off by default: strokes can recover detail outside the current pixel selection. Brush
              size is measured in image pixels.
            </p>
            <FieldRow label="Edge method">
              <Select
                label="Edge method"
                value={refineMethod}
                options={[
                  { value: 'guided', label: 'Guided (already-soft edges)' },
                  { value: 'closed-form', label: 'Matting (binary-safe)' },
                ]}
                onChange={(v) => setRefineMaskOptions({ method: v as 'guided' | 'closed-form' })}
              />
            </FieldRow>
            <FieldRow label="Edge radius" htmlFor="bg-refine-radius-range">
              <RangeValueControl
                id="bg-refine-radius"
                label="Edge radius"
                value={refineRadius}
                min={1}
                max={24}
                unit="px"
                rangeAriaLabel="Edge refinement radius in image pixels"
                onChange={(value) => setRefineMaskOptions({ radius: value })}
              />
            </FieldRow>
            {refineMethod === 'closed-form' && (
              <FieldRow label="Unknown band" htmlFor="bg-refine-band-range">
                <RangeValueControl
                  id="bg-refine-band"
                  label="Unknown band"
                  value={refineBandRadius}
                  min={1}
                  max={48}
                  unit="px"
                  rangeAriaLabel="Matting unknown band width in image pixels"
                  onChange={(value) => setRefineMaskOptions({ bandRadius: value })}
                />
              </FieldRow>
            )}
            <div className="insp-actions">
              <Button type="button" variant="default" size="sm" onClick={handleDoneMaskEditing}>
                Done
              </Button>
            </div>
          </div>
        )}

        {maskEditorOpen && editingTrimap && maskProvenance && (
          <div className="insp-nested-panel">
            <p className="insp-subsection__label">Trimap</p>
            <canvas
              ref={trimapPreviewRef}
              className="trimap-preview"
              role="img"
              aria-label="Trimap preview: green foreground, grey background, amber unknown"
            />
            <p className="insp-hint">
              Green is definite foreground, grey is definite background, amber is unknown. Unknown
              is a constraint region, not 50% opacity; matting estimates the coverage inside it.
            </p>
            <FieldRow label="Pen">
              <Select
                label="Trimap pen"
                value={trimapOpts.penMode}
                options={[
                  { value: 'foreground', label: 'Foreground' },
                  { value: 'unknown', label: 'Unknown' },
                  { value: 'background', label: 'Background' },
                ]}
                onChange={(v) =>
                  setTrimapEditOptions({
                    penMode: v as 'foreground' | 'unknown' | 'background',
                  })
                }
              />
            </FieldRow>
            <FieldRow label="Brush size" htmlFor="bg-trimap-brush-range">
              <RangeValueControl
                id="bg-trimap-brush"
                label="Trimap brush size"
                value={trimapOpts.brushSize}
                min={5}
                max={100}
                unit="px"
                rangeAriaLabel="Trimap brush size"
                onChange={(value) => setTrimapEditOptions({ brushSize: value })}
              />
            </FieldRow>
            <div className="insp-actions">
              <Button type="button" variant="default" size="sm" onClick={handleApplyTrimap}>
                Apply trimap matting
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTool('select')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {showDownloadDialog && (
          <ModelDownloadDialog
            modelId={downloadModelId ?? requiredModelId ?? ''}
            onClose={() => {
              setShowDownloadDialog(false);
              setDownloadModelId(null);
            }}
            onComplete={() => {
              setShowDownloadDialog(false);
              setDownloadModelId(null);
              void refreshModelStatus();
            }}
          />
        )}
      </DisclosureSection>
    </>
  );
}
