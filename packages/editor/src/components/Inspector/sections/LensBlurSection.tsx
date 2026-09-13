import type { DepthMap, DepthMapResource } from '@varve/engine';
import {
  applyDepthBlur,
  depthToHeatmapImageData,
  deserializeDepthMap,
  getInferenceWorkerHost,
  getModelLoader,
  normalizeDepthPrediction,
  resizeDepthMap,
  sampleDepth,
  serializeDepthMap,
  sourceAlphaToDepthValidity,
  unletterboxDepthMap,
} from '@varve/engine';
import type { Effect, SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button, Separator, Switch } from '@varve/ui';
import { type MouseEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor, useViewport } from '../../../context';
import { containDepthPreview, depthPreviewPointToMap } from '../../../depth/depthPreviewLayout';
import { worldPointToImageMaskPixel } from '../../../tools/imageMaskCoordinates';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { RangeValueControl } from '../controls/RangeValueControl';

const DEPTH_MODEL_ID = 'depth-anything-v2-small';
const DEPTH_MODEL_VERSION = '2.0.0';
const DEPTH_MODEL_CHECKSUM = '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001';
const DEPTH_PREPROCESSING_VERSION = 1;

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Every await before `host.infer` was unbounded, and `infer`'s own 120s
 * timeout only covers the worker round trip. A stalled image decode or model
 * lookup therefore left "Generating depth map…" on screen indefinitely with
 * no error. Each phase now has a bounded wait and the user can cancel the
 * worker-backed phase explicitly.
 */
function withPhaseTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error('cancelled')));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))),
      ms,
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

function loadImageToImageData(src: string, signal?: AbortSignal): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      img.onload = null;
      img.onerror = null;
    };
    const resolveOnce = () => {
      cleanup();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    const rejectOnce = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      img.src = '';
      rejectOnce(new Error('cancelled'));
    };
    img.onload = resolveOnce;
    img.onerror = () => rejectOnce(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = src;
  });
}

async function ensureDepthModelDownloaded(
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const loader = getModelLoader(signal);

  // Try getting the path first — may be already downloaded
  let modelPath = await loader.getModelPath(DEPTH_MODEL_ID, signal);
  if (modelPath) return modelPath;

  // Not downloaded yet — trigger a download that stores in IndexedDB
  await loader.downloadModel(DEPTH_MODEL_ID, onProgress, signal);
  modelPath = await loader.getModelPath(DEPTH_MODEL_ID, signal);
  if (!modelPath)
    throw new Error('Depth model download failed — model path not resolved after download');
  return modelPath;
}

async function checkDepthModelCached(): Promise<boolean> {
  const loader = getModelLoader();
  return await loader.isModelAvailable(DEPTH_MODEL_ID);
}

interface DepthBlurParams {
  blurAmount: number;
  focalDepth: number;
  transitionRange: number;
  invert: boolean;
}

export function LensBlurSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const { canvasToWorld } = useViewport();
  const node = nodes[0] as ShapeNode | undefined;

  const [modelState, setModelState] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelError, setModelError] = useState<string | null>(null);

  const [depthState, setDepthState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [depthData, setDepthData] = useState<DepthMap | null>(null);
  const [depthResource, setDepthResource] = useState<DepthMapResource | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  const [params, setParams] = useState<DepthBlurParams>({
    blurAmount: 5,
    focalDepth: 50,
    transitionRange: 20,
    invert: false,
  });
  const [livePreview, setLivePreview] = useState(false);
  const [previewDepth, setPreviewDepth] = useState(false);
  const [pickFocus, setPickFocus] = useState(false);
  const [pickFromCanvas, setPickFromCanvas] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Monotonic id of the latest generate run; only the latest may write state. */
  const generateRunRef = useRef(0);
  const generateAbortRef = useRef<AbortController | null>(null);

  const blurAmountId = useId();
  const focalDepthId = useId();
  const transitionRangeId = useId();

  const src = node && isImageShape(node) ? imageShapeSrc(node) : '';
  const sourceAssetId = node?.fills?.find((fill) => fill.type === 'image')?.image?.assetId;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;

  const existingDepthEffect = node?.effects?.find((effect) => effect.type === 'depthBlur');
  const depthEffectId =
    existingDepthEffect?.type === 'depthBlur' ? existingDepthEffect.id : undefined;
  const depthMapId =
    existingDepthEffect?.type === 'depthBlur' ? existingDepthEffect.depthMapId : undefined;

  useEffect(() => {
    return () => {
      generateRunRef.current += 1;
      const controller = generateAbortRef.current;
      if (!controller) return;
      controller.abort();
      generateAbortRef.current = null;
    };
  }, [sourceAsset?.hash, src, node?.id]);

  useEffect(() => {
    setDepthData(null);
    setDepthResource(null);
    setDepthState('idle');
    setInferenceError(null);
    if (!node || !existingDepthEffect || existingDepthEffect.type !== 'depthBlur') return;
    const resource = depthMapId ? state.document.depthMaps?.[depthMapId] : undefined;
    if (!resource) return;
    if (resource.sourceHash && sourceAsset?.hash && resource.sourceHash !== sourceAsset.hash) {
      setInferenceError('The source image changed. Regenerate the DepthMap to update this effect.');
      setDepthState('error');
      return;
    }
    try {
      const decoded = deserializeDepthMap(resource);
      setDepthData(decoded);
      setDepthResource(resource);
      setDepthState('ready');
      setParams({
        blurAmount: existingDepthEffect.blurStrength,
        focalDepth: existingDepthEffect.focusDepth * 100,
        transitionRange: existingDepthEffect.focusRange * 100,
        invert: existingDepthEffect.invert,
      });
    } catch {
      setInferenceError('Saved depth map is unavailable. Regenerate it to continue.');
      setDepthState('error');
    }
  }, [src, node?.id, depthEffectId, depthMapId, sourceAsset?.hash, state.document.depthMaps]);

  useEffect(() => {
    if (!livePreview || !depthData || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const render = async () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = src;
      });
      if (cancelled) return;
      const layout = containDepthPreview(img.naturalWidth, img.naturalHeight);
      canvas.width = Math.max(1, Math.round(layout.drawWidth));
      canvas.height = Math.max(1, Math.round(layout.drawHeight));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const depthResized = resizeDepthMap(depthData, canvas.width, canvas.height);
      const result = applyDepthBlur(imageData, depthResized, {
        blurAmount: params.blurAmount,
        focalDepth: params.focalDepth / 100,
        transitionRange: params.transitionRange / 100,
        invert: params.invert,
        edgeProtection: 0.035,
      });
      ctx.putImageData(result, 0, 0);
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [livePreview, depthData, params, src]);

  useEffect(() => {
    if (!depthData || !heatmapCanvasRef.current) return;
    const canvas = heatmapCanvasRef.current;
    const layout = containDepthPreview(depthData.width, depthData.height);
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const source = document.createElement('canvas');
    source.width = depthData.width;
    source.height = depthData.height;
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return;
    const preview = new Uint8Array(depthData.values.length);
    for (let i = 0; i < preview.length; i++) {
      preview[i] = depthData.valid[i] ? Math.round(depthData.values[i]! * 255) : 0;
    }
    const heatmap = depthToHeatmapImageData(preview, depthData.width, depthData.height);
    for (let i = 0; i < depthData.valid.length; i++) {
      if (!depthData.valid[i]) heatmap.data[i * 4 + 3] = 0;
    }
    sourceCtx.putImageData(heatmap, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(127, 127, 127, 0.16)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight);
  }, [depthData, pickFocus, previewDepth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await checkDepthModelCached();
      if (!cancelled && cached) {
        setModelState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadAbortRef = useRef<AbortController | null>(null);

  const handleDownloadModel = useCallback(async () => {
    setModelState('downloading');
    setModelError(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      await ensureDepthModelDownloaded((loaded, total) => {
        setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
      }, controller.signal);
      setModelState('ready');
    } catch (err) {
      if (controller.signal.aborted) {
        setModelState('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Download failed';
      setModelError(msg);
      setModelState('error');
    } finally {
      downloadAbortRef.current = null;
    }
  }, []);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleGenerateDepth = useCallback(async () => {
    if (!src) return;
    // Guard on "a newer generate superseded me", not on "the source-generation
    // ref moved". That ref is bumped by an effect keyed on [src, node.id], so a
    // re-render during inference could bump it while this run was still the
    // only one in flight — and both the success and failure paths then returned
    // without touching state, stranding the panel on "Generating depth map…"
    // with no error. A newer run always writes state itself, so deferring to it
    // is safe; deferring to a bare ref bump was not.
    const runId = ++generateRunRef.current;
    const nodeAtStart = node;
    const sourceAssetIdAtStart = sourceAssetId;
    const sourceHashAtStart = sourceAsset?.hash;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setDepthState('generating');
    setInferenceError(null);
    try {
      const imageData = await withPhaseTimeout(
        loadImageToImageData(src, controller.signal),
        30_000,
        'Loading the source image',
        controller.signal,
      );
      const loader = getModelLoader(controller.signal);
      const modelPath = await withPhaseTimeout(
        loader.getModelPath(DEPTH_MODEL_ID, controller.signal),
        30_000,
        'Resolving the depth model',
        controller.signal,
      );
      if (!modelPath) throw new Error('Depth model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await withPhaseTimeout(
        host.infer(
          {
            type: 'infer',
            modelType: 'depth',
            modelPath,
            modelId: DEPTH_MODEL_ID,
            imageData,
            params: {},
            reuseSession: true,
          },
          { timeoutMs: 900_000, signal: controller.signal },
        ),
        900_000,
        'Running depth inference',
        controller.signal,
      );
      if (runId !== generateRunRef.current) return;

      // Different verified exports use `output` or `predicted_depth`; accept
      // both names but reject an unknown tensor rather than attaching garbage.
      const depthOutput = (result.outputs.predicted_depth ?? result.outputs.output) as
        | { data: Float32Array; dims: number[] }
        | undefined;
      if (!depthOutput?.data || !Array.isArray(depthOutput.dims)) {
        throw new Error('Depth model returned no supported output tensor');
      }
      const rawData = depthOutput.data;
      const dims = depthOutput.dims;
      // The pinned export outputs [1, 518, 518]; older exports used
      // [1, 1, H, W]. Read the last two dims so either shape works.
      const outputH = dims[dims.length - 2] as number;
      const outputW = dims[dims.length - 1] as number;
      const letterbox = result.outputs.letterbox as
        | { offsetX: number; offsetY: number; contentWidth?: number; contentHeight?: number }
        | undefined;
      // ImageData is RGBA; the depth contract deliberately accepts a compact
      // one-byte alpha plane so RGB from transparent pixels can never affect
      // validity statistics or padding registration.
      const sourceAlpha = new Uint8Array(imageData.width * imageData.height);
      for (let index = 0; index < sourceAlpha.length; index++) {
        sourceAlpha[index] = imageData.data[index * 4 + 3] ?? 0;
      }
      const sourceValidity = sourceAlphaToDepthValidity(
        sourceAlpha,
        imageData.width,
        imageData.height,
        outputW,
        outputH,
        letterbox,
      );
      const normalized = normalizeDepthPrediction(rawData, outputW, outputH, {
        // The pinned export's raw convention is nearIsHigh (verified by
        // scripts/models/verify-depth-model.mjs).
        nearFarConvention: 'nearIsHigh',
        valid: sourceValidity,
        metadata: {
          modelId: DEPTH_MODEL_ID,
          modelVersion: DEPTH_MODEL_VERSION,
          sourceAssetId: sourceAssetIdAtStart,
          sourceHash: sourceHashAtStart,
          sourceRevision: 1,
          preprocessingVersion: DEPTH_PREPROCESSING_VERSION,
          inferenceVersion: 1,
          generatedAt: Date.now(),
        },
      });
      const aligned = letterbox
        ? unletterboxDepthMap(normalized, imageData.width, imageData.height, letterbox)
        : resizeDepthMap(normalized, imageData.width, imageData.height);
      const accepted = {
        ...aligned,
        metadata: {
          ...aligned.metadata,
          registration: {
            schemaVersion: 1 as const,
            sourceWidth: imageData.width,
            sourceHeight: imageData.height,
            mapWidth: aligned.width,
            mapHeight: aligned.height,
            coordinateSpace: 'source-image-pixels' as const,
            orientation: 'top-left' as const,
            sourceToMap: [1, 0, 0, 1, 0, 0] as const,
          },
          provenance: {
            origin: 'generated' as const,
            format: 'onnx',
            ...(typeof result.outputs.executionProvider === 'string'
              ? { runtime: result.outputs.executionProvider }
              : {}),
            modelId: DEPTH_MODEL_ID,
            modelVersion: DEPTH_MODEL_VERSION,
            modelChecksum: DEPTH_MODEL_CHECKSUM,
            preprocessingVersion: DEPTH_PREPROCESSING_VERSION,
          },
        },
      } satisfies DepthMap;
      const resourceId = `depth-${nodeAtStart?.id ?? 'image'}-${sourceAssetIdAtStart ?? 'source'}`;
      const resource = serializeDepthMap(accepted, resourceId);
      // The accepted resource is the persisted truth. Decode it once before
      // preview/apply so a slider value on the in-memory float field cannot
      // disagree with the reopened uint16 map at a narrow boundary.
      setDepthData(deserializeDepthMap(resource));
      setDepthResource(resource);
      setDepthState('ready');
    } catch (err) {
      if (runId !== generateRunRef.current) return;
      if (controller.signal.aborted) {
        setInferenceError('Depth generation cancelled');
        setDepthState('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Depth inference failed';
      setInferenceError(msg);
      setDepthState('error');
    } finally {
      if (generateAbortRef.current === controller) generateAbortRef.current = null;
    }
  }, [node, sourceAsset?.hash, sourceAssetId, src]);

  const handleCancelGenerate = useCallback(() => {
    const controller = generateAbortRef.current;
    if (!controller) return;
    generateRunRef.current += 1;
    controller.abort();
    // The shared host detaches this request and discards its late result. It
    // must stay alive because segmentation/enhancement jobs may share it.
    generateAbortRef.current = null;
    setDepthState('idle');
    setInferenceError('Depth generation cancelled');
  }, []);

  const handleRegenerate = useCallback(() => {
    setDepthData(null);
    setDepthResource(null);
    setDepthState('idle');
    setInferenceError(null);
  }, []);

  const handleApply = useCallback(async () => {
    if (!depthResource || !depthData || depthState !== 'ready' || !node) return;
    setInferenceError(null);
    try {
      const effect: Effect = {
        type: 'depthBlur',
        id: existingDepthEffect?.id ?? `depth-blur-${node.id}`,
        depthMapId: depthResource.id,
        focusDepth: params.focalDepth / 100,
        focusRange: params.transitionRange / 100,
        blurStrength: params.blurAmount,
        falloff: 1,
        invert: params.invert,
        edgeProtection: 0.035,
        visible: true,
      };
      let committed = false;
      updateDoc((doc) => {
        const current = doc.nodes[node.id];
        const currentSourceAsset = sourceAssetId ? doc.assets?.[sourceAssetId] : undefined;
        if (
          !current ||
          current !== node ||
          !('effects' in current) ||
          (depthResource.sourceAssetId !== undefined &&
            depthResource.sourceAssetId !== sourceAssetId) ||
          (depthResource.sourceHash !== undefined &&
            currentSourceAsset?.hash !== depthResource.sourceHash)
        )
          return doc;
        committed = true;
        const effects = current.effects ?? [];
        const index = existingDepthEffect?.id
          ? effects.findIndex(
              (candidate) =>
                candidate.type === 'depthBlur' && candidate.id === existingDepthEffect.id,
            )
          : effects.findIndex((candidate) => candidate.type === 'depthBlur');
        const nextEffects = [...effects];
        if (index >= 0) nextEffects[index] = effect;
        else nextEffects.push(effect);
        return {
          ...doc,
          depthMaps: { ...(doc.depthMaps ?? {}), [depthResource.id]: depthResource },
          nodes: { ...doc.nodes, [node.id]: { ...current, effects: nextEffects } },
        };
      });
      if (!committed) throw new Error('The source changed; the depth result was not applied');
      announce(`Depth Blur saved (blur ${params.blurAmount}px, focus ${params.focalDepth}%)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setInferenceError(msg);
    }
  }, [
    announce,
    depthData,
    depthResource,
    depthState,
    existingDepthEffect?.id,
    node,
    params,
    sourceAssetId,
    updateDoc,
  ]);

  const handleDepthPreviewClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!pickFocus || !depthData) return;
      const layout = containDepthPreview(depthData.width, depthData.height);
      const point = depthPreviewPointToMap(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        layout,
      );
      if (!point) return;
      const index = point.y * depthData.width + point.x;
      if (!depthData.valid[index]) return;
      setParams((current) => ({
        ...current,
        focalDepth: Math.round(depthData.values[index]! * 100),
      }));
      setPickFocus(false);
      announce('Depth Blur focus selected from the depth preview');
    },
    [announce, depthData, pickFocus],
  );

  const handleSaveDepthMap = useCallback(() => {
    if (!depthResource || !depthData || depthState !== 'ready' || !node) return;
    let committed = false;
    updateDoc((doc) => {
      if (
        doc.nodes[node.id] !== node ||
        (depthResource.sourceAssetId !== undefined &&
          depthResource.sourceAssetId !== sourceAssetId) ||
        (sourceAssetId &&
          depthResource.sourceHash !== undefined &&
          doc.assets?.[sourceAssetId]?.hash !== depthResource.sourceHash)
      )
        return doc;
      committed = true;
      return {
        ...doc,
        depthMaps: { ...(doc.depthMaps ?? {}), [depthResource.id]: depthResource },
      };
    });
    if (!committed) {
      setInferenceError('The source changed; the depth map was not saved');
      return;
    }
    announce('Depth map saved for reuse by masks and effects');
  }, [announce, depthData, depthResource, depthState, node, sourceAssetId, updateDoc]);

  // Canvas-integrated focus picking: while armed, the next pointer press on
  // the canvas is mapped screen -> world -> node -> source pixel -> DepthMap
  // sample, so focus follows the user's click at any zoom or rotation.
  useEffect(() => {
    if (!pickFromCanvas || !depthData || !node) return;
    const canvasSelector = 'canvas.editor-canvas__content-layer';
    const onPointerDown = (event: PointerEvent) => {
      const canvas =
        document.querySelector<HTMLElement>(canvasSelector) ??
        document.querySelector<HTMLElement>('.editor-canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const world = canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const pixel = worldPointToImageMaskPixel({
        document: state.document,
        node,
        sourceWidth: depthData.width,
        sourceHeight: depthData.height,
        worldPoint: world,
      });
      // Clicks outside the image leave the picker armed.
      if (!pixel) return;
      const value = sampleDepth(depthData, pixel.x, pixel.y, 2);
      if (value === null) return;
      setParams((current) => ({ ...current, focalDepth: Math.round(value * 100) }));
      setPickFromCanvas(false);
      announce(`Depth Blur focus set to ${Math.round(value * 100)}% (picked from canvas)`);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPickFromCanvas(false);
      announce('Focus picking cancelled');
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [announce, canvasToWorld, depthData, node, pickFromCanvas, state.document]);

  const handleRemoveDepthBlur = useCallback(() => {
    if (!node) return;
    updateDoc((doc) => {
      const current = doc.nodes[node.id];
      if (!current || !('effects' in current)) return doc;
      let removed = false;
      const effects = (current.effects ?? []).filter((effect) => {
        if (effect.type !== 'depthBlur') return true;
        if (depthEffectId && effect.id !== depthEffectId) return true;
        if (removed) return true;
        removed = true;
        return false;
      });
      const next: typeof doc = {
        ...doc,
        nodes: { ...doc.nodes, [node.id]: { ...current, effects } },
      };
      // Accepted maps are document resources and may be reused by a depth
      // mask after this effect is removed. Explicit resource deletion owns
      // pruning; removing one consumer must not discard a reusable map.
      return next;
    });
    setDepthData(null);
    setDepthResource(null);
    setDepthState('idle');
    setInferenceError(null);
    announce('Depth Blur removed');
  }, [announce, depthEffectId, node, updateDoc]);

  if (!node || !isImageShape(node)) return null;

  const showBlurControls = depthState === 'ready' && depthData !== null && depthResource !== null;

  return (
    <DisclosureSection title="Depth Blur" sectionId="lens-blur">
      <div className="insp-field-group">
        {modelState === 'idle' && !depthResource && (
          <div className="insp-actions">
            <Button type="button" variant="default" size="sm" onClick={handleDownloadModel}>
              Enable Depth Blur
            </Button>
            <p className="insp-hint">
              One-time local model download (~27 MB). It is stored on this device and is only needed
              to generate or regenerate a DepthMap.
            </p>
          </div>
        )}

        {modelState === 'downloading' && (
          <div className="insp-actions">
            <div
              className="insp-progress-bar"
              role="progressbar"
              aria-valuenow={downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
            </div>
            <p className="insp-hint" aria-live="polite">
              Downloading… {downloadProgress}%
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
              Cancel
            </Button>
          </div>
        )}

        {modelState === 'error' && (
          <p className="insp-hint insp-hint--error" role="alert">
            {modelError ?? 'Failed to download depth model'}
          </p>
        )}

        {modelState === 'ready' && depthState === 'idle' && !depthResource && (
          <div className="insp-actions">
            <Button type="button" variant="default" size="sm" onClick={handleGenerateDepth}>
              Generate Depth Map
            </Button>
            <p className="insp-hint">
              Analyzes the photo once; the saved DepthMap can drive multiple effects.
            </p>
          </div>
        )}

        {depthState === 'generating' && (
          <div className="insp-actions">
            <p className="insp-hint" role="status">
              Generating depth map… (this may take a moment)
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancelGenerate}>
              Cancel
            </Button>
          </div>
        )}

        {inferenceError && (
          <p className="insp-hint insp-hint--error" role="alert">
            {inferenceError}
          </p>
        )}

        {depthData && depthState === 'ready' && (
          <>
            <p className="insp-subsection__label">Depth Map Preview</p>
            <Switch
              className="insp-switch"
              label="Preview depth (near to far)"
              checked={previewDepth}
              onChange={(event) => setPreviewDepth(event.target.checked)}
            />
            {(previewDepth || pickFocus) && (
              <div className="insp-depth-heatmap">
                <canvas
                  ref={heatmapCanvasRef}
                  className="insp-depth-heatmap__canvas"
                  aria-label="Depth map preview; near is blue and far is red"
                  onClick={handleDepthPreviewClick}
                  style={{ cursor: pickFocus ? 'crosshair' : 'default' }}
                />
              </div>
            )}

            <div className="insp-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPickFocus(true);
                  setPreviewDepth(true);
                }}
              >
                {pickFocus ? 'Click Depth Preview…' : 'Pick Focus'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickFromCanvas((armed) => !armed)}
                aria-pressed={pickFromCanvas}
              >
                {pickFromCanvas ? 'Click Image on Canvas…' : 'Pick Focus from Canvas'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleRegenerate}>
                Regenerate Depth Map
              </Button>
            </div>
          </>
        )}

        {showBlurControls && (
          <>
            <Separator className="insp-divider" decorative tone="subtle" />

            <p className="insp-subsection__label">Blur Controls</p>

            <FieldRow label="Blur Amount" htmlFor={`${blurAmountId}-range`}>
              <RangeValueControl
                id={blurAmountId}
                label="Blur Amount"
                value={params.blurAmount}
                min={0}
                max={20}
                step={1}
                unit="px"
                rangeClassName="insp-range"
                rangeAriaLabel="Blur amount"
                onChange={(value) => setParams((p) => ({ ...p, blurAmount: value }))}
              />
            </FieldRow>

            <FieldRow label="Focal Distance" htmlFor={`${focalDepthId}-range`}>
              <RangeValueControl
                id={focalDepthId}
                label="Focal Distance"
                value={params.focalDepth}
                min={0}
                max={100}
                step={1}
                unit="%"
                rangeClassName="insp-range"
                rangeAriaLabel="Focal distance"
                onChange={(value) => setParams((p) => ({ ...p, focalDepth: value }))}
              />
            </FieldRow>

            <FieldRow label="Transition Range" htmlFor={`${transitionRangeId}-range`}>
              <RangeValueControl
                id={transitionRangeId}
                label="Transition Range"
                value={params.transitionRange}
                min={0}
                max={100}
                step={1}
                unit="%"
                rangeClassName="insp-range"
                rangeAriaLabel="Transition range"
                onChange={(value) => setParams((p) => ({ ...p, transitionRange: value }))}
              />
            </FieldRow>

            <Switch
              className="insp-switch"
              label="Invert depth"
              checked={params.invert}
              onChange={(e) => setParams((p) => ({ ...p, invert: e.target.checked }))}
            />

            <Switch
              className="insp-switch"
              label="Live preview"
              checked={livePreview}
              onChange={(e) => setLivePreview(e.target.checked)}
            />

            {livePreview && (
              <div className="insp-depth-preview">
                <canvas
                  ref={previewCanvasRef}
                  className="insp-depth-preview__canvas"
                  aria-label="Lens blur preview"
                />
              </div>
            )}

            <div className="insp-actions">
              <Button type="button" variant="default" size="sm" onClick={handleApply}>
                Save Depth Blur
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleSaveDepthMap}>
                Save Depth Map
              </Button>
              {depthEffectId && (
                <Button type="button" variant="ghost" size="sm" onClick={handleRemoveDepthBlur}>
                  Remove Depth Blur
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </DisclosureSection>
  );
}
