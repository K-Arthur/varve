import type { DepthMap, DepthMapResource } from '@varve/engine';
import {
  applyLensBlur,
  depthRangeToMask,
  depthToHeatmapImageData,
  deserializeDepthMap,
  getInferenceWorkerHost,
  getModelLoader,
  normalizeDepthPrediction,
  sampleDepth,
  serializeDepthMap,
} from '@varve/engine';
import type { Effect, SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button } from '@varve/ui';
import { type MouseEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { commitRasterMask } from '../../../backgroundRemoval/commitRasterMask';
import { useEditor, useViewport } from '../../../context';
import { worldPointToImageMaskPixel } from '../../../tools/imageMaskCoordinates';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

const DEPTH_MODEL_ID = 'depth-anything-v2-small';

function loadImageToImageData(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
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
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
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

function resizeDepthMapForPreview(map: DepthMap, width: number, height: number): DepthMap {
  if (map.width === width && map.height === height) return map;
  const values = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const xScale = map.width / width;
  const yScale = map.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(map.height - 1, Math.max(0, (y + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(map.height - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(map.width - 1, Math.max(0, (x + 0.5) * xScale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(map.width - 1, x0 + 1);
      const tx = sx - x0;
      const i00 = y0 * map.width + x0;
      const i10 = y0 * map.width + x1;
      const i01 = y1 * map.width + x0;
      const i11 = y1 * map.width + x1;
      const out = y * width + x;
      const count =
        Number(map.valid[i00]) +
        Number(map.valid[i10]) +
        Number(map.valid[i01]) +
        Number(map.valid[i11]);
      if (count === 0) {
        values[out] = 0.5;
        continue;
      }
      values[out] =
        map.values[i00]! * (1 - tx) * (1 - ty) +
        map.values[i10]! * tx * (1 - ty) +
        map.values[i01]! * (1 - tx) * ty +
        map.values[i11]! * tx * ty;
      valid[out] = 1;
    }
  }
  return { ...map, width, height, values, valid };
}

function resizeDepthForPreview(map: DepthMap, width: number, height: number): Uint8Array {
  const resized = resizeDepthMapForPreview(map, width, height);
  const result = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) result[i] = Math.round((1 - resized.values[i]!) * 255);
  return result;
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
  const [maskParams, setMaskParams] = useState({ near: 0, far: 100, feather: 10, invert: false });
  const [livePreview, setLivePreview] = useState(false);
  const [previewDepth, setPreviewDepth] = useState(false);
  const [pickFocus, setPickFocus] = useState(false);
  const [pickFromCanvas, setPickFromCanvas] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceGenerationRef = useRef(0);

  const blurAmountId = useId();
  const focalDepthId = useId();
  const transitionRangeId = useId();
  const maskNearId = useId();
  const maskFarId = useId();
  const maskFeatherId = useId();

  const src = node && isImageShape(node) ? imageShapeSrc(node) : '';
  const sourceAssetId = node?.fills?.find((fill) => fill.type === 'image')?.image?.assetId;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;

  const existingDepthEffect = node?.effects?.find((effect) => effect.type === 'depthBlur');
  const depthEffectId =
    existingDepthEffect?.type === 'depthBlur' ? existingDepthEffect.id : undefined;
  const depthMapId =
    existingDepthEffect?.type === 'depthBlur' ? existingDepthEffect.depthMapId : undefined;

  useEffect(() => {
    sourceGenerationRef.current += 1;
  }, [src, node?.id]);

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
      canvas.width = Math.min(img.naturalWidth, 300);
      canvas.height = Math.min(img.naturalHeight, 200);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const depthResized = resizeDepthForPreview(depthData, canvas.width, canvas.height);
      const result = applyLensBlur(imageData, depthResized, {
        blurAmount: params.blurAmount,
        focalDepth: params.focalDepth / 100,
        transitionRange: params.transitionRange / 100,
        invert: params.invert,
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
    canvas.width = Math.min(depthData.width, 300);
    canvas.height = Math.min(depthData.height, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const preview = new Uint8Array(depthData.values.length);
    for (let i = 0; i < preview.length; i++) preview[i] = Math.round(depthData.values[i]! * 255);
    const heatmap = depthToHeatmapImageData(preview, depthData.width, depthData.height);
    ctx.putImageData(heatmap, 0, 0);
  }, [depthData]);

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
    const generation = sourceGenerationRef.current;
    const nodeAtStart = node;
    const sourceAssetIdAtStart = sourceAssetId;
    setDepthState('generating');
    setInferenceError(null);
    try {
      const imageData = await loadImageToImageData(src);
      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(DEPTH_MODEL_ID);
      if (!modelPath) throw new Error('Depth model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'depth',
          modelPath,
          modelId: DEPTH_MODEL_ID,
          imageData,
          params: {},
          reuseSession: true,
        },
        { timeoutMs: 120_000 },
      );
      if (generation !== sourceGenerationRef.current) return;

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
      const normalized = normalizeDepthPrediction(rawData, outputW, outputH, {
        // The pinned export's raw convention is nearIsHigh (verified by
        // scripts/models/verify-depth-model.mjs).
        nearFarConvention: 'nearIsHigh',
        metadata: {
          modelId: DEPTH_MODEL_ID,
          modelVersion: '2.0.0',
          sourceAssetId: sourceAssetIdAtStart,
          sourceHash: sourceAsset?.hash,
          sourceRevision: 1,
          preprocessingVersion: 1,
          inferenceVersion: 1,
          generatedAt: Date.now(),
        },
      });
      const aligned = resizeDepthMapForPreview(normalized, imageData.width, imageData.height);
      const resourceId = `depth-${nodeAtStart?.id ?? 'image'}-${sourceAssetIdAtStart ?? 'source'}`;
      const resource = serializeDepthMap(aligned, resourceId);
      setDepthData(aligned);
      setDepthResource(resource);
      setDepthState('ready');
    } catch (err) {
      if (generation !== sourceGenerationRef.current) return;
      const msg = err instanceof Error ? err.message : 'Depth inference failed';
      setInferenceError(msg);
      setDepthState('error');
    }
  }, [node, sourceAsset?.hash, sourceAssetId, src]);

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
      updateDoc((doc) => {
        const current = doc.nodes[node.id];
        if (!current || !('effects' in current)) return doc;
        const effects = current.effects ?? [];
        const index = effects.findIndex((candidate) => candidate.type === 'depthBlur');
        const nextEffects = [...effects];
        if (index >= 0) nextEffects[index] = effect;
        else nextEffects.push(effect);
        return {
          ...doc,
          depthMaps: { ...(doc.depthMaps ?? {}), [depthResource.id]: depthResource },
          nodes: { ...doc.nodes, [node.id]: { ...current, effects: nextEffects } },
        };
      });
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
    updateDoc,
  ]);

  const handleDepthPreviewClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!pickFocus || !depthData) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * depthData.width;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * depthData.height;
      const index =
        Math.min(depthData.height - 1, Math.max(0, Math.floor(y))) * depthData.width +
        Math.min(depthData.width - 1, Math.max(0, Math.floor(x)));
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

  const handleCreateDepthMask = useCallback(() => {
    if (!depthData || !depthResource || !node) return;
    try {
      const coverage = depthRangeToMask(
        depthData,
        maskParams.near / 100,
        maskParams.far / 100,
        maskParams.feather / 100,
        maskParams.invert,
      );
      const canvas = document.createElement('canvas');
      canvas.width = depthData.width;
      canvas.height = depthData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const encoded = new ImageData(
        new Uint8ClampedArray(depthData.width * depthData.height * 4),
        canvas.width,
        canvas.height,
      );
      for (let i = 0; i < coverage.length; i++) {
        const offset = i * 4;
        encoded.data[offset] = 255;
        encoded.data[offset + 1] = 255;
        encoded.data[offset + 2] = 255;
        encoded.data[offset + 3] = coverage[i]!;
      }
      ctx.putImageData(encoded, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      updateDoc((doc) =>
        commitRasterMask(doc, node.id, {
          dataUrl,
          width: depthData.width,
          height: depthData.height,
          method: 'quick',
          runtime: 'typescript',
          modelId: depthResource.modelId,
          modelVersion: depthResource.modelVersion,
          generatedAt: depthResource.generatedAt,
          sourceLocator: imageShapeSrc(node),
        }),
      );
      announce(
        `Depth mask created for ${maskParams.invert ? 'outside' : 'inside'} the depth range`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Mask creation failed';
      setInferenceError(msg);
    }
  }, [announce, depthData, depthResource, maskParams, node, updateDoc]);

  const handleRemoveDepthBlur = useCallback(() => {
    if (!node) return;
    updateDoc((doc) => {
      const current = doc.nodes[node.id];
      if (!current || !('effects' in current)) return doc;
      const effects = (current.effects ?? []).filter((effect) => effect.type !== 'depthBlur');
      const next: typeof doc = {
        ...doc,
        nodes: { ...doc.nodes, [node.id]: { ...current, effects } },
      };
      // Drop depth resources no longer referenced by any node effect.
      const referenced = new Set<string>();
      for (const candidate of Object.values(next.nodes)) {
        if (!('effects' in candidate)) continue;
        for (const effect of candidate.effects ?? []) {
          if (effect.type === 'depthBlur') referenced.add(effect.depthMapId);
        }
      }
      const remaining = next.depthMaps
        ? Object.fromEntries(Object.entries(next.depthMaps).filter(([id]) => referenced.has(id)))
        : undefined;
      return {
        ...next,
        depthMaps: remaining && Object.keys(remaining).length > 0 ? remaining : undefined,
      };
    });
    setDepthData(null);
    setDepthResource(null);
    setDepthState('idle');
    setInferenceError(null);
    announce('Depth Blur removed');
  }, [announce, node, updateDoc]);

  if (!node || !isImageShape(node)) return null;

  const showBlurControls = depthState === 'ready' && depthData !== null && depthResource !== null;

  return (
    <DisclosureSection title="Depth Blur" sectionId="lens-blur">
      <div className="insp-field-group">
        {modelState === 'idle' && !depthResource && (
          <div className="insp-actions">
            <Button type="button" variant="primary" size="sm" onClick={handleDownloadModel}>
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
            <Button type="button" variant="primary" size="sm" onClick={handleGenerateDepth}>
              Generate Depth Map
            </Button>
            <p className="insp-hint">
              Analyzes the photo once; the saved DepthMap can drive multiple effects.
            </p>
          </div>
        )}

        {depthState === 'generating' && (
          <p className="insp-hint" role="status">
            Generating depth map… (this may take a moment)
          </p>
        )}

        {inferenceError && (
          <p className="insp-hint insp-hint--error" role="alert">
            {inferenceError}
          </p>
        )}

        {depthData && depthState === 'ready' && (
          <>
            <p className="insp-subsection__label">Depth Map Preview</p>
            <label className="insp-check">
              <input
                type="checkbox"
                className="insp-checkbox"
                checked={previewDepth}
                onChange={(event) => setPreviewDepth(event.target.checked)}
              />
              <span>Preview Depth (near to far)</span>
            </label>
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
            <hr className="insp-divider" />

            <p className="insp-subsection__label">Blur Controls</p>

            <FieldRow label="Blur Amount" htmlFor={blurAmountId}>
              <input
                id={blurAmountId}
                type="range"
                className="insp-range"
                min={0}
                max={20}
                step={1}
                value={params.blurAmount}
                aria-label="Blur amount"
                onChange={(e) => setParams((p) => ({ ...p, blurAmount: Number(e.target.value) }))}
              />
              <output htmlFor={blurAmountId}>{params.blurAmount}px</output>
            </FieldRow>

            <FieldRow label="Focal Distance" htmlFor={focalDepthId}>
              <input
                id={focalDepthId}
                type="range"
                className="insp-range"
                min={0}
                max={100}
                step={1}
                value={params.focalDepth}
                aria-label="Focal distance"
                onChange={(e) => setParams((p) => ({ ...p, focalDepth: Number(e.target.value) }))}
              />
              <output htmlFor={focalDepthId}>{params.focalDepth}%</output>
            </FieldRow>

            <FieldRow label="Transition Range" htmlFor={transitionRangeId}>
              <input
                id={transitionRangeId}
                type="range"
                className="insp-range"
                min={0}
                max={100}
                step={1}
                value={params.transitionRange}
                aria-label="Transition range"
                onChange={(e) =>
                  setParams((p) => ({ ...p, transitionRange: Number(e.target.value) }))
                }
              />
              <output htmlFor={transitionRangeId}>{params.transitionRange}%</output>
            </FieldRow>

            <label className="insp-check">
              <input
                type="checkbox"
                className="insp-checkbox"
                checked={params.invert}
                onChange={(e) => setParams((p) => ({ ...p, invert: e.target.checked }))}
              />
              <span>Invert Depth</span>
            </label>

            <label className="insp-check">
              <input
                type="checkbox"
                className="insp-checkbox"
                checked={livePreview}
                onChange={(e) => setLivePreview(e.target.checked)}
              />
              <span>Live preview</span>
            </label>

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
              <Button type="button" variant="primary" size="sm" onClick={handleApply}>
                Save Depth Blur
              </Button>
              {depthEffectId && (
                <Button type="button" variant="ghost" size="sm" onClick={handleRemoveDepthBlur}>
                  Remove Depth Blur
                </Button>
              )}
            </div>
          </>
        )}

        {depthData && depthState === 'ready' && (
          <>
            <hr className="insp-divider" />
            <p className="insp-subsection__label">Depth Range Mask</p>
            <p className="insp-hint">
              Converts the DepthMap into a non-destructive layer mask. Useful for foreground or
              background selection; the mask can be used by adjustments and other effects.
            </p>
            <FieldRow label="Near" htmlFor={maskNearId}>
              <input
                id={maskNearId}
                type="range"
                className="insp-range"
                min={0}
                max={100}
                step={1}
                value={maskParams.near}
                aria-label="Mask near threshold"
                onChange={(e) => setMaskParams((p) => ({ ...p, near: Number(e.target.value) }))}
              />
              <output htmlFor={maskNearId}>{maskParams.near}%</output>
            </FieldRow>
            <FieldRow label="Far" htmlFor={maskFarId}>
              <input
                id={maskFarId}
                type="range"
                className="insp-range"
                min={0}
                max={100}
                step={1}
                value={maskParams.far}
                aria-label="Mask far threshold"
                onChange={(e) => setMaskParams((p) => ({ ...p, far: Number(e.target.value) }))}
              />
              <output htmlFor={maskFarId}>{maskParams.far}%</output>
            </FieldRow>
            <FieldRow label="Feather" htmlFor={maskFeatherId}>
              <input
                id={maskFeatherId}
                type="range"
                className="insp-range"
                min={0}
                max={50}
                step={1}
                value={maskParams.feather}
                aria-label="Mask feather"
                onChange={(e) => setMaskParams((p) => ({ ...p, feather: Number(e.target.value) }))}
              />
              <output htmlFor={maskFeatherId}>{maskParams.feather}%</output>
            </FieldRow>
            <label className="insp-check">
              <input
                type="checkbox"
                className="insp-checkbox"
                checked={maskParams.invert}
                onChange={(e) => setMaskParams((p) => ({ ...p, invert: e.target.checked }))}
              />
              <span>Invert (select outside range)</span>
            </label>
            <div className="insp-actions">
              <Button type="button" variant="ghost" size="sm" onClick={handleCreateDepthMask}>
                Create Depth Mask
              </Button>
            </div>
          </>
        )}
      </div>
    </DisclosureSection>
  );
}
