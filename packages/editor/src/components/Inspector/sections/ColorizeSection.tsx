/**
 * ColorizeSection — source-preserving deterministic color workflows with an
 * explicitly gated local photo-colorization lane.
 *
 * The panel owns authored intent (mode, swatches, reference, mask and
 * parameters). Inference state is transient; Apply materializes an embedded
 * output asset through colorizationCommit.ts so the source remains untouched.
 */
import type {
  ChromaPlanes,
  ColorizationProgressPhase,
  ColorizationRequestContract,
  ColorizationResultContract,
  QualityMode,
  SourceKind,
} from '@varve/engine';
import type { ColorSwatch, SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape, managedColorToHex } from '@varve/scene';
import { Button, Select, Switch } from '@varve/ui';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { commitColorizationResult, planColorizeApply } from '../../../colorizationCommit';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { RangeValueControl } from '../controls/RangeValueControl';
import './ColorizeSection.css';

type ColorizeWorkflow = 'photo' | 'recolor' | 'palette' | 'transfer' | 'harmonize';
type RecolorScope = 'whole' | 'mask';
type PaletteMode = 'shaded' | 'strict';

interface ReferenceSelection {
  src: string;
  data: ImageData;
  revision: number;
}

interface MaskSelection {
  data: Uint8Array;
  width: number;
  height: number;
  revision: number;
}

interface ColorizeState {
  status: 'idle' | 'previewing' | 'applying' | 'error';
  phase: ColorizationProgressPhase | null;
  errorMessage: string | null;
  previewDataUrl: string | null;
  previewImageData: ImageData | null;
  previewChroma: ChromaPlanes | null;
  previewSourceKind: SourceKind | null;
  previewSignature: string | null;
  previewSourceSrc: string | null;
  previewSourceId: string | null;
  elapsedMs: number;
}

/**
 * Preview model resolution per quality mode. The preview and the final apply
 * resolve the model to the same input size, so Apply never introduces colors
 * the user has not seen; Apply only reconstructs the approved chroma over the
 * full-resolution source L-star/detail.
 */
const PREVIEW_MAX_DIMENSIONS: Record<QualityMode, number> = {
  fast: 256,
  balanced: 512,
  quality: 1024,
  automatic: 1024,
};

const PHASE_LABELS: Record<ColorizationProgressPhase, string> = {
  preprocessing: 'Preparing source',
  'model-download': 'Loading model',
  encoding: 'Encoding',
  inference: 'Running model',
  decoding: 'Decoding',
  postprocessing: 'Compositing',
  compositing: 'Compositing',
  complete: 'Finalizing',
};

function phaseLabel(phase: ColorizationProgressPhase | null): string | null {
  return phase ? (PHASE_LABELS[phase] ?? 'Processing') : null;
}

function workflowKind(workflow: ColorizeWorkflow): ColorizationRequestContract['kind'] {
  switch (workflow) {
    case 'photo':
      return 'photo-colorize';
    case 'palette':
      return 'palette-colorize';
    case 'transfer':
      return 'reference-transfer';
    case 'harmonize':
      return 'harmonize';
    default:
      return 'selective-recolor';
  }
}

function maskFromImage(image: ImageData): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const index = pixel * 4;
    const luminance =
      0.2126 * (image.data[index] ?? 0) +
      0.7152 * (image.data[index + 1] ?? 0) +
      0.0722 * (image.data[index + 2] ?? 0);
    mask[pixel] = Math.round((luminance * (image.data[index + 3] ?? 255)) / 255);
  }
  return mask;
}

function imageDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function swatchHex(swatch: ColorSwatch): string | null {
  try {
    return managedColorToHex(swatch.color);
  } catch {
    return null;
  }
}

/**
 * Split-view comparator: the approved preview on the left of the handle, the
 * untouched source on the right. Both images come from the same source and
 * share the same aspect ratio, so the overlay needs no resampling.
 */
function ColorizeCompare({ sourceSrc, previewSrc }: { sourceSrc: string; previewSrc: string }) {
  const [split, setSplit] = useState(50);
  const sliderId = useId();
  return (
    <div className="colorize-section__compare">
      <img
        className="colorize-section__compare-base"
        src={sourceSrc}
        alt="Original source for comparison"
      />
      <div
        className="colorize-section__compare-overlay"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        aria-hidden="true"
      >
        <img className="colorize-section__compare-top" src={previewSrc} alt="" />
      </div>
      <span className="colorize-section__compare-tag colorize-section__compare-tag--left">
        Preview
      </span>
      <span className="colorize-section__compare-tag colorize-section__compare-tag--right">
        Original
      </span>
      <div className="colorize-section__compare-control">
        <label className="insp-hint" htmlFor={sliderId}>
          Reveal
        </label>
        <input
          id={sliderId}
          className="colorize-section__compare-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          aria-label="Reveal colorize preview over the original image"
        />
      </div>
    </div>
  );
}

export function ColorizeSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce, setSelection, groupCompoundOperation } = useEditor();
  const node = nodes[0];
  const hueId = useId();
  const satId = useId();
  const lumId = useId();
  const blendId = useId();
  const chromaId = useId();
  const adherenceId = useId();
  const referenceInputId = useId();
  const maskInputId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const elapsedRef = useRef<number | null>(null);
  const referenceUrlRef = useRef<string | null>(null);
  const liveStateRef = useRef(state);
  const operationGenerationRef = useRef(0);
  const parameterSignatureRef = useRef('');

  const [workflow, setWorkflow] = useState<ColorizeWorkflow>('recolor');
  const [targetHue, setTargetHue] = useState(0);
  const [hueMode, setHueMode] = useState<'set' | 'rotate'>('set');
  const [saturationScale, setSaturationScale] = useState(1);
  const [luminancePreservation, setLuminancePreservation] = useState(1);
  const [blendStrength, setBlendStrength] = useState(1);
  const [chromaStrength, setChromaStrength] = useState(1);
  const [adherence, setAdherence] = useState(0.5);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('shaded');
  const [qualityMode, setQualityMode] = useState<QualityMode>('balanced');
  const [skinProtection, setSkinProtection] = useState(true);
  const [neutralProtection, setNeutralProtection] = useState(true);
  const [recolorScope, setRecolorScope] = useState<RecolorScope>('whole');
  const [selectedSwatchIds, setSelectedSwatchIds] = useState<string[]>([]);
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [mask, setMask] = useState<MaskSelection | null>(null);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [colorize, setColorize] = useState<ColorizeState>({
    status: 'idle',
    phase: null,
    errorMessage: null,
    previewDataUrl: null,
    previewImageData: null,
    previewChroma: null,
    previewSourceKind: null,
    previewSignature: null,
    previewSourceSrc: null,
    previewSourceId: null,
    elapsedMs: 0,
  });

  liveStateRef.current = state;
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';
  const sourceId = typedNode?.id ?? '';
  const documentSwatches = state.document.swatches ?? [];

  const usableSwatches = useMemo(
    () =>
      documentSwatches.flatMap((swatch) => {
        const hex = swatchHex(swatch);
        return hex ? [{ swatch, hex }] : [];
      }),
    [documentSwatches],
  );

  const selectedPalette = useMemo(
    () =>
      selectedSwatchIds.flatMap((id) => {
        const entry = usableSwatches.find((candidate) => candidate.swatch.id === id);
        return entry ? [entry] : [];
      }),
    [selectedSwatchIds, usableSwatches],
  );

  const operationSignature = useMemo(
    () =>
      JSON.stringify({
        workflow,
        targetHue,
        hueMode,
        saturationScale,
        luminancePreservation,
        blendStrength,
        chromaStrength,
        adherence,
        paletteMode,
        qualityMode,
        skinProtection,
        neutralProtection,
        recolorScope,
        swatches: selectedPalette.map(({ swatch, hex }) => [swatch.id, hex]),
        referenceRevision: reference?.revision ?? null,
        maskRevision: mask?.revision ?? null,
      }),
    [
      workflow,
      targetHue,
      hueMode,
      saturationScale,
      luminancePreservation,
      blendStrength,
      chromaStrength,
      adherence,
      paletteMode,
      qualityMode,
      skinProtection,
      neutralProtection,
      recolorScope,
      selectedPalette,
      reference?.revision,
      mask?.revision,
    ],
  );
  parameterSignatureRef.current = operationSignature;

  const invalidatePreview = useCallback(() => {
    operationGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setColorize((previous) => ({
      ...previous,
      status: 'idle',
      phase: null,
      errorMessage: null,
      previewDataUrl: null,
      previewImageData: null,
      previewChroma: null,
      previewSourceKind: null,
      previewSignature: null,
      previewSourceSrc: null,
      previewSourceId: null,
      elapsedMs: 0,
    }));
  }, []);

  useEffect(() => {
    if (workflow !== 'photo') {
      setModelAvailable(null);
      return;
    }
    let active = true;
    setModelAvailable(null);
    void import('@varve/engine')
      .then(async ({ getModelLoaderReady }) => {
        const loader = await getModelLoaderReady();
        const available =
          (await loader.isModelAvailable('ddcolor-tiny')) ||
          (await loader.isModelAvailable('ddcolor'));
        if (active) setModelAvailable(available);
      })
      .catch(() => {
        if (active) setModelAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [workflow]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (colorize.status !== 'previewing' && colorize.status !== 'applying') return;
    setColorize((previous) => ({ ...previous, elapsedMs: 0 }));
    const startedAt = Date.now();
    elapsedRef.current = window.setInterval(() => {
      setColorize((previous) => ({ ...previous, elapsedMs: Date.now() - startedAt }));
    }, 250);
    return () => {
      if (elapsedRef.current !== null) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [colorize.status]);

  const loadImageData = useCallback(
    async (src: string, maxDimension?: number): Promise<ImageData> => {
      const { cachedImageDims, getImageCache } = await import('@varve/engine');
      const image = await getImageCache().load(src);
      const sourceDimensions = cachedImageDims(image);
      const sourceLongestEdge = Math.max(sourceDimensions.width, sourceDimensions.height);
      const scale =
        maxDimension && sourceLongestEdge > maxDimension ? maxDimension / sourceLongestEdge : 1;
      const width = Math.max(1, Math.round(sourceDimensions.width * scale));
      const height = Math.max(1, Math.round(sourceDimensions.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height);
    },
    [],
  );

  const runColorize = useCallback(
    async (
      fullData: ImageData,
      intent: 'preview' | 'full',
      expectedSignature: string,
      controller: AbortController,
    ): Promise<ColorizationResultContract> => {
      const { clampImageToMaxDimension, dispatchColorization, generateColorizationRequestId } =
        await import('@varve/engine');
      const liveState = liveStateRef.current;
      const previewMaxDimension = PREVIEW_MAX_DIMENSIONS[qualityMode];
      const processingData =
        intent === 'preview' ? clampImageToMaxDimension(fullData, previewMaxDimension) : fullData;
      const currentMask =
        workflow === 'recolor'
          ? recolorScope === 'whole'
            ? {
                data: new Uint8Array(processingData.width * processingData.height).fill(255),
                width: processingData.width,
                height: processingData.height,
                revision: 0,
              }
            : mask
          : null;
      if (workflow === 'recolor' && !currentMask) {
        throw new Error('Choose a mask image or switch scope to Whole image');
      }
      if ((workflow === 'transfer' || workflow === 'harmonize') && !reference) {
        throw new Error('Choose a reference image before previewing');
      }
      if (workflow === 'palette' && selectedPalette.length === 0) {
        throw new Error('Select at least one document swatch before previewing');
      }

      const request: ColorizationRequestContract = {
        requestId: generateColorizationRequestId(),
        documentId: liveState.document.id,
        parameterVersion: expectedSignature,
        kind: workflowKind(workflow),
        source: {
          nodeId: sourceId,
          revision: liveState.revision,
          width: processingData.width,
          height: processingData.height,
          colorProfile: liveState.document.colorConfig?.workingSpace,
        },
        qualityMode,
        provider: {
          backend: 'auto',
          intent,
          previewMaxDimension,
        },
        mask: currentMask
          ? {
              maskId: 'colorize-mask',
              revision: currentMask.revision,
              data: currentMask.data,
              width: currentMask.width,
              height: currentMask.height,
            }
          : undefined,
        palette:
          workflow === 'palette'
            ? {
                colors: selectedPalette.map(({ hex }) => hex),
                swatchIds: selectedPalette.map(({ swatch }) => swatch.id),
                revision: liveState.revision,
                adherence,
              }
            : undefined,
        reference: reference
          ? {
              assetId: 'colorize-reference',
              revision: reference.revision,
              width: reference.data.width,
              height: reference.data.height,
              src: reference.src,
            }
          : undefined,
        params: {
          targetHue,
          hueMode,
          saturationScale,
          luminancePreservation,
          chromaStrength,
          blendStrength,
          paletteMode,
          skinProtection,
          neutralProtection,
        },
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setColorize((previous) =>
            previous.phase === progress.phase ? previous : { ...previous, phase: progress.phase },
          );
        },
      };

      const result = await dispatchColorization(request, processingData, reference?.data);
      if (controller.signal.aborted) throw new Error('Colorization cancelled');
      if (parameterSignatureRef.current !== expectedSignature) {
        throw new Error('Colorize result is stale because its controls changed');
      }
      const currentSource = liveStateRef.current.document.nodes[sourceId];
      if (
        liveStateRef.current.selection.length !== 1 ||
        liveStateRef.current.selection[0] !== sourceId ||
        !currentSource ||
        currentSource.kind !== 'shape' ||
        !isImageShape(currentSource) ||
        imageShapeSrc(currentSource) !== imageSrc
      ) {
        throw new Error('Colorize result is stale because the source changed');
      }
      return result;
    },
    [
      workflow,
      recolorScope,
      mask,
      reference,
      selectedPalette,
      sourceId,
      imageSrc,
      qualityMode,
      targetHue,
      hueMode,
      saturationScale,
      luminancePreservation,
      chromaStrength,
      blendStrength,
      paletteMode,
      adherence,
      skinProtection,
      neutralProtection,
    ],
  );

  const canRun =
    Boolean(imageSrc) &&
    (workflow === 'photo'
      ? modelAvailable === true
      : workflow === 'palette'
        ? selectedPalette.length > 0
        : workflow === 'transfer' || workflow === 'harmonize'
          ? reference !== null
          : recolorScope === 'whole' || mask !== null);

  const previewIsCurrent =
    colorize.previewSignature === operationSignature &&
    colorize.previewSourceSrc === imageSrc &&
    colorize.previewSourceId === sourceId;
  const canApply = canRun && colorize.previewDataUrl !== null && previewIsCurrent;

  const handlePreview = useCallback(async () => {
    if (!imageSrc || !canRun) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++operationGenerationRef.current;
    const expectedSignature = operationSignature;
    setColorize((previous) => ({
      ...previous,
      status: 'previewing',
      phase: null,
      errorMessage: null,
      previewDataUrl: null,
      previewImageData: null,
      previewChroma: null,
      previewSourceKind: null,
      previewSignature: null,
      previewSourceSrc: null,
      previewSourceId: null,
      elapsedMs: 0,
    }));

    try {
      const previewData = await loadImageData(imageSrc, PREVIEW_MAX_DIMENSIONS[qualityMode]);
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;
      const result = await runColorize(previewData, 'preview', expectedSignature, controller);
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;
      setColorize((previous) => ({
        ...previous,
        status: 'idle',
        phase: null,
        previewDataUrl: imageDataUrl(result.imageData),
        previewImageData: result.imageData,
        previewChroma: result.chroma ?? null,
        previewSourceKind: result.sourceKind ?? null,
        previewSignature: expectedSignature,
        previewSourceSrc: imageSrc,
        previewSourceId: sourceId,
        elapsedMs: 0,
      }));
      announce('Colorize preview ready');
    } catch (error) {
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;
      const message = error instanceof Error ? error.message : 'Preview failed';
      setColorize((previous) => ({
        ...previous,
        status: 'error',
        phase: null,
        errorMessage: message,
      }));
    }
  }, [imageSrc, canRun, operationSignature, loadImageData, runColorize, announce, qualityMode]);

  const handleApply = useCallback(async () => {
    if (!imageSrc || !canRun || !colorize.previewDataUrl || !previewIsCurrent) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++operationGenerationRef.current;
    const expectedSignature = operationSignature;
    const capturedSourceId = sourceId;
    const capturedSourceSrc = imageSrc;
    setColorize((previous) => ({
      ...previous,
      status: 'applying',
      phase: null,
      errorMessage: null,
      elapsedMs: 0,
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;
      const plan = planColorizeApply({
        previewSignature: colorize.previewSignature,
        previewSourceSrc: colorize.previewSourceSrc,
        previewWidth: colorize.previewImageData?.width ?? null,
        previewHeight: colorize.previewImageData?.height ?? null,
        hasPreviewImage: colorize.previewImageData !== null,
        hasPreviewChroma: colorize.previewChroma !== null,
        expectedSignature,
        sourceSrc: capturedSourceSrc,
        fullWidth: fullData.width,
        fullHeight: fullData.height,
      });
      let result: ImageData;
      if (plan === 'reuse-preview-image') {
        // The preview already ran at source resolution; commit it verbatim.
        result = colorize.previewImageData!;
      } else if (plan === 'reuse-preview-chroma') {
        // Rebuild the approved model chroma over the full-resolution source
        // L*/detail and alpha. No second inference, no color surprise.
        const { combineChromaAtSourceResolution } = await import('@varve/engine');
        result = combineChromaAtSourceResolution(fullData, colorize.previewChroma!);
      } else {
        result = (await runColorize(fullData, 'full', expectedSignature, controller)).imageData;
      }
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;

      const dataUrl = imageDataUrl(result);
      const currentState = liveStateRef.current;
      if (
        currentState.selection.length !== 1 ||
        currentState.selection[0] !== capturedSourceId ||
        currentState.document.nodes[capturedSourceId] === undefined
      ) {
        throw new Error('Colorize result is stale because the selection changed');
      }
      let insertedNodeId: string | null = null;
      groupCompoundOperation('Colorize', () => {
        updateDoc((doc) => {
          const currentSource = doc.nodes[capturedSourceId];
          if (
            currentSource?.kind !== 'shape' ||
            !isImageShape(currentSource) ||
            imageShapeSrc(currentSource) !== capturedSourceSrc
          ) {
            return doc;
          }
          const committed = commitColorizationResult(doc, {
            sourceId: capturedSourceId,
            sourceSrc: capturedSourceSrc,
            dataUrl,
            width: result.width,
            height: result.height,
            suffix: `${workflow}-result`,
          });
          insertedNodeId = committed.nodeId;
          return committed.doc;
        });
      });
      if (!insertedNodeId) {
        throw new Error('Colorize result is stale because the source changed');
      }
      if (insertedNodeId) setSelection(insertedNodeId);
      announce(`Colorize applied (${result.width} x ${result.height})`);
      invalidatePreview();
    } catch (error) {
      if (controller.signal.aborted || generation !== operationGenerationRef.current) return;
      const message = error instanceof Error ? error.message : 'Apply failed';
      setColorize((previous) => ({ ...previous, status: 'error', errorMessage: message }));
    }
  }, [
    imageSrc,
    canRun,
    colorize.previewDataUrl,
    colorize.previewImageData,
    colorize.previewChroma,
    colorize.previewSignature,
    colorize.previewSourceSrc,
    previewIsCurrent,
    operationSignature,
    sourceId,
    loadImageData,
    runColorize,
    workflow,
    updateDoc,
    groupCompoundOperation,
    setSelection,
    announce,
    invalidatePreview,
  ]);

  const handleCancel = useCallback(() => {
    operationGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setColorize((previous) => ({ ...previous, status: 'idle', phase: null, elapsedMs: 0 }));
    announce('Colorize cancelled');
  }, [announce]);

  const handleReferenceFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const url = URL.createObjectURL(file);
      try {
        const data = await loadImageData(url);
        if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
        referenceUrlRef.current = url;
        setReference({ src: url, data, revision: Date.now() });
        invalidatePreview();
      } catch (error) {
        URL.revokeObjectURL(url);
        setColorize((previous) => ({
          ...previous,
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Reference image could not be read',
        }));
      }
    },
    [loadImageData, invalidatePreview],
  );

  const handleMaskFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const url = URL.createObjectURL(file);
      try {
        const data = await loadImageData(url);
        setMask({
          data: maskFromImage(data),
          width: data.width,
          height: data.height,
          revision: Date.now(),
        });
        setRecolorScope('mask');
        invalidatePreview();
      } catch (error) {
        setColorize((previous) => ({
          ...previous,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Mask image could not be read',
        }));
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [loadImageData, invalidatePreview],
  );

  if (!isImage || !typedNode) return null;

  const isProcessing = colorize.status === 'previewing' || colorize.status === 'applying';
  const showPreview = colorize.previewDataUrl !== null;
  const showsLuminance = workflow === 'recolor' || workflow === 'transfer';
  const showsBlend = workflow === 'recolor' || workflow === 'transfer' || workflow === 'harmonize';
  const showsChroma = workflow === 'recolor' || workflow === 'transfer' || workflow === 'harmonize';
  const showsProtection = workflow === 'recolor' || workflow === 'harmonize';

  return (
    <DisclosureSection title="Colorize" sectionId="colorize">
      <div className="insp-field-group">
        <p className="insp-hint">
          Colorize preserves the selected image. Automatic photo colorization infers plausible
          colors; it cannot recover verified historical color. Deterministic modes stay offline and
          do not require a model or account.
        </p>

        <FieldRow label="Mode">
          <Select
            label="Colorization workflow"
            value={workflow}
            disabled={isProcessing}
            onChange={(value) => {
              setWorkflow(value as ColorizeWorkflow);
              invalidatePreview();
            }}
            options={[
              { value: 'photo', label: 'Photo Colorization (AI)' },
              { value: 'recolor', label: 'Tint / Selective Recolor' },
              { value: 'palette', label: 'Palette Colorize' },
              { value: 'transfer', label: 'Reference Transfer' },
              { value: 'harmonize', label: 'Harmonize' },
            ]}
          />
        </FieldRow>

        {workflow === 'photo' && (
          <div className="colorize-section__model-status" aria-live="polite">
            <p className="insp-hint">
              DDColor runs locally when a verified model is installed. The model proposes chroma
              while the original detail, lightness, and alpha are retained.
            </p>
            {modelAvailable === null && (
              <span className="colorize-section__model-badge">Checking model readiness…</span>
            )}
            {modelAvailable === true && (
              <span className="colorize-section__model-badge">Verified DDColor model ready</span>
            )}
            {modelAvailable === false && (
              <span className="colorize-section__model-badge colorize-section__model-badge--warning">
                No verified DDColor model installed. Open Settings &gt; Models to install one.
              </span>
            )}
          </div>
        )}

        {workflow === 'recolor' && (
          <>
            <FieldRow label="Scope">
              <Select
                label="Recolor scope"
                value={recolorScope}
                disabled={isProcessing}
                onChange={(value) => {
                  setRecolorScope(value as RecolorScope);
                  invalidatePreview();
                }}
                options={[
                  { value: 'whole', label: 'Whole image' },
                  { value: 'mask', label: 'Mask image' },
                ]}
              />
            </FieldRow>
            {recolorScope === 'mask' && (
              <div className="colorize-section__input-group">
                <input
                  id={maskInputId}
                  className="colorize-section__file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleMaskFile}
                  disabled={isProcessing}
                  aria-label="Choose recolor mask image"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => document.getElementById(maskInputId)?.click()}
                  disabled={isProcessing}
                >
                  {mask ? 'Replace mask image' : 'Choose mask image'}
                </Button>
                {mask && (
                  <span className="colorize-section__input-status">
                    Mask {mask.width} x {mask.height}
                  </span>
                )}
              </div>
            )}
            <FieldRow label="Hue behavior">
              <Select
                label="Hue behavior"
                value={hueMode}
                disabled={isProcessing}
                onChange={(value) => {
                  setHueMode(value as 'set' | 'rotate');
                  invalidatePreview();
                }}
                options={[
                  { value: 'set', label: 'Set absolute hue' },
                  { value: 'rotate', label: 'Rotate existing hue' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Hue" htmlFor={`${hueId}-range`}>
              <RangeValueControl
                id={hueId}
                label="Hue"
                value={targetHue}
                min={hueMode === 'set' ? 0 : -180}
                max={hueMode === 'set' ? 360 : 180}
                step={1}
                unit="deg"
                disabled={isProcessing}
                rangeClassName="insp-range"
                rangeAriaLabel={
                  hueMode === 'set' ? 'Target absolute hue in degrees' : 'Hue rotation in degrees'
                }
                onChange={(value) => {
                  setTargetHue(value);
                  invalidatePreview();
                }}
              />
            </FieldRow>
            <FieldRow label="Saturation" htmlFor={`${satId}-range`}>
              <RangeValueControl
                id={satId}
                label="Saturation"
                value={saturationScale}
                min={0}
                max={3}
                step={0.05}
                unit="x"
                disabled={isProcessing}
                rangeClassName="insp-range"
                rangeAriaLabel="Saturation scale"
                onChange={(value) => {
                  setSaturationScale(value);
                  invalidatePreview();
                }}
              />
            </FieldRow>
          </>
        )}

        {workflow === 'palette' && (
          <>
            <p className="insp-hint">
              Select document swatches. Shaded mapping keeps source lightness and may create tonal
              shades; strict mapping uses only the selected sRGB swatch bytes at 100% adherence.
            </p>
            <fieldset className="colorize-section__swatches">
              <legend className="sr-only">Palette swatches</legend>
              {usableSwatches.length === 0 && (
                <p className="insp-hint">This document has no usable swatches yet.</p>
              )}
              {usableSwatches.map(({ swatch, hex }) => {
                const selected = selectedSwatchIds.includes(swatch.id);
                return (
                  <button
                    type="button"
                    key={swatch.id}
                    className={`colorize-section__swatch${selected ? ' colorize-section__swatch--selected' : ''}`}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Remove' : 'Use'} swatch ${swatch.name}`}
                    onClick={() => {
                      setSelectedSwatchIds((ids) =>
                        ids.includes(swatch.id)
                          ? ids.filter((id) => id !== swatch.id)
                          : [...ids, swatch.id],
                      );
                      invalidatePreview();
                    }}
                  >
                    <span
                      className="colorize-section__swatch-chip"
                      style={{ backgroundColor: hex }}
                    />
                    <span>{swatch.name}</span>
                  </button>
                );
              })}
            </fieldset>
            <FieldRow label="Mapping">
              <Select
                label="Palette mapping"
                value={paletteMode}
                disabled={isProcessing}
                onChange={(value) => {
                  setPaletteMode(value as PaletteMode);
                  invalidatePreview();
                }}
                options={[
                  { value: 'shaded', label: 'Shaded palette influence' },
                  { value: 'strict', label: 'Strict palette colors' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Adherence" htmlFor={`${adherenceId}-range`}>
              <RangeValueControl
                id={adherenceId}
                label="Adherence"
                value={adherence}
                min={0}
                max={1}
                step={0.05}
                unit="%"
                displayScale={100}
                disabled={isProcessing}
                rangeClassName="insp-range"
                rangeAriaLabel="Palette adherence"
                onChange={(value) => {
                  setAdherence(value);
                  invalidatePreview();
                }}
              />
            </FieldRow>
          </>
        )}

        {(workflow === 'transfer' || workflow === 'harmonize') && (
          <div className="colorize-section__input-group">
            <input
              id={referenceInputId}
              className="colorize-section__file-input"
              type="file"
              accept="image/*"
              onChange={handleReferenceFile}
              disabled={isProcessing}
              aria-label="Choose color reference image"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => document.getElementById(referenceInputId)?.click()}
              disabled={isProcessing}
            >
              {reference ? 'Replace reference image' : 'Choose reference image'}
            </Button>
            {reference && (
              <>
                <img
                  className="colorize-section__reference-thumb"
                  src={reference.src}
                  alt="Selected color reference"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
                    referenceUrlRef.current = null;
                    setReference(null);
                    invalidatePreview();
                  }}
                  disabled={isProcessing}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        )}

        {workflow === 'photo' && (
          <fieldset className="colorize-section__quality-row">
            <legend className="insp-label">Quality</legend>
            <div
              className="colorize-section__quality-options"
              role="radiogroup"
              aria-label="Quality mode"
            >
              {(['fast', 'balanced', 'quality', 'automatic'] as QualityMode[]).map((mode) => (
                <label
                  key={mode}
                  className={`insp-radio-btn${qualityMode === mode ? ' insp-radio-btn--active' : ''}`}
                >
                  <input
                    type="radio"
                    name="quality-mode"
                    checked={qualityMode === mode}
                    disabled={isProcessing}
                    onChange={() => {
                      setQualityMode(mode);
                      invalidatePreview();
                    }}
                  />
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {workflow !== 'photo' && showsLuminance && (
          <FieldRow label="Lightness" htmlFor={`${lumId}-range`}>
            <RangeValueControl
              id={lumId}
              label="Lightness"
              value={luminancePreservation}
              min={0}
              max={1}
              step={0.05}
              unit="%"
              displayScale={100}
              disabled={isProcessing}
              rangeClassName="insp-range"
              rangeAriaLabel="Source lightness preservation"
              onChange={(value) => {
                setLuminancePreservation(value);
                invalidatePreview();
              }}
            />
          </FieldRow>
        )}

        {workflow !== 'photo' && showsChroma && (
          <FieldRow label="Chroma" htmlFor={`${chromaId}-range`}>
            <RangeValueControl
              id={chromaId}
              label="Chroma"
              value={chromaStrength}
              min={0}
              max={2}
              step={0.05}
              unit="x"
              disabled={isProcessing}
              rangeClassName="insp-range"
              rangeAriaLabel="Chroma strength"
              onChange={(value) => {
                setChromaStrength(value);
                invalidatePreview();
              }}
            />
          </FieldRow>
        )}

        {workflow !== 'photo' && showsBlend && (
          <FieldRow label="Blend" htmlFor={`${blendId}-range`}>
            <RangeValueControl
              id={blendId}
              label="Blend"
              value={blendStrength}
              min={0}
              max={1}
              step={0.05}
              unit="%"
              displayScale={100}
              disabled={isProcessing}
              rangeClassName="insp-range"
              rangeAriaLabel="Blend strength"
              onChange={(value) => {
                setBlendStrength(value);
                invalidatePreview();
              }}
            />
          </FieldRow>
        )}

        {workflow !== 'photo' && showsProtection && (
          <div className="insp-field-group">
            <Switch
              className="insp-switch"
              label="Protect near-neutral pixels"
              checked={neutralProtection}
              disabled={isProcessing}
              onChange={(event) => {
                setNeutralProtection(event.target.checked);
                invalidatePreview();
              }}
            />
            {workflow === 'recolor' && (
              <Switch
                className="insp-switch"
                label="Protect skin-like pixels (heuristic)"
                checked={skinProtection}
                disabled={isProcessing}
                onChange={(event) => {
                  setSkinProtection(event.target.checked);
                  invalidatePreview();
                }}
              />
            )}
          </div>
        )}

        {showPreview && (
          <section className="insp-nested-panel" aria-label="Colorize preview">
            <p className="insp-subsection__label">Preview</p>
            <div className="colorize-section__preview-frame">
              <img src={colorize.previewDataUrl!} alt="Colorize preview" />
            </div>
            {colorize.previewSourceSrc === imageSrc && (
              <ColorizeCompare sourceSrc={imageSrc} previewSrc={colorize.previewDataUrl!} />
            )}
            {!previewIsCurrent && (
              <p className="insp-hint colorize-section__stale" role="status">
                This preview is out of date for the current selection or settings. Generate a new
                preview before applying.
              </p>
            )}
            {workflow === 'photo' && (
              <p className="insp-hint">
                Apply rebuilds the approved preview&apos;s predicted colors over the full-resolution
                original; source detail and alpha are retained.
              </p>
            )}
            {workflow === 'photo' && colorize.previewSourceKind === 'already-colored' && (
              <p className="insp-hint">
                This image already contains strong color. Photo colorization replaces its chroma
                with inferred colors; use Tint / Selective Recolor to adjust existing colors
                instead.
              </p>
            )}
            <div className="insp-actions">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing || !canApply}
                loading={colorize.status === 'applying'}
                aria-label="Apply colorization at full resolution"
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={invalidatePreview}
                disabled={isProcessing}
              >
                Discard
              </Button>
            </div>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                {phaseLabel(colorize.phase) ??
                  (colorize.status === 'previewing' ? 'Generating preview' : 'Applying colorize')}
                … {Math.round(colorize.elapsedMs / 1000)}s
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                aria-label="Cancel colorization"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                disabled={!canRun}
                aria-label="Generate colorize preview"
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={!canApply}
                onClick={handleApply}
                aria-label="Apply colorization at full resolution"
              >
                Apply Full
              </Button>
            </>
          )}
        </div>

        {colorize.status === 'error' && colorize.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {colorize.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
