import {
  applyLensBlur,
  decodeDepthOutput,
  depthToHeatmapImageData,
  getInferenceWorkerHost,
  getModelLoader,
} from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor } from '../../../context';
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

interface LensBlurParams {
  blurAmount: number;
  focalDepth: number;
  transitionRange: number;
  invert: boolean;
}

export function LensBlurSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0] as ShapeNode | undefined;

  const [modelState, setModelState] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelError, setModelError] = useState<string | null>(null);

  const [depthState, setDepthState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [depthMap, setDepthMap] = useState<Uint8Array | null>(null);
  const [depthWidth, setDepthWidth] = useState(0);
  const [depthHeight, setDepthHeight] = useState(0);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  const [params, setParams] = useState<LensBlurParams>({
    blurAmount: 5,
    focalDepth: 50,
    transitionRange: 20,
    invert: false,
  });
  const [livePreview, setLivePreview] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);

  const blurAmountId = useId();
  const focalDepthId = useId();
  const transitionRangeId = useId();

  const src = node && isImageShape(node) ? imageShapeSrc(node) : '';

  useEffect(() => {
    setDepthMap(null);
    setDepthState('idle');
    setInferenceError(null);
  }, [src]);

  useEffect(() => {
    if (!livePreview || !depthMap || !previewCanvasRef.current) return;
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

      const depthResized = new Uint8Array(canvas.width * canvas.height);
      const xRatio = depthWidth / canvas.width;
      const yRatio = depthHeight / canvas.height;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const sx = Math.min(Math.floor(x * xRatio), depthWidth - 1);
          const sy = Math.min(Math.floor(y * yRatio), depthHeight - 1);
          depthResized[y * canvas.width + x] = depthMap[sy * depthWidth + sx]!;
        }
      }

      const result = applyLensBlur(imageData, depthResized, params);
      ctx.putImageData(result, 0, 0);
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [livePreview, depthMap, depthWidth, depthHeight, params, src]);

  useEffect(() => {
    if (!depthMap || !heatmapCanvasRef.current) return;
    const canvas = heatmapCanvasRef.current;
    canvas.width = Math.min(depthWidth, 300);
    canvas.height = Math.min(depthHeight, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const heatmap = depthToHeatmapImageData(depthMap, depthWidth, depthHeight);
    ctx.putImageData(heatmap, 0, 0);
  }, [depthMap, depthWidth, depthHeight]);

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

      // The worker keys each output by its real ONNX tensor name (never a
      // generic "data"/"dims"). Verified directly against the downloaded
      // depth-anything-v2-small graph: the single output is named
      // "predicted_depth", not "data" — reading result.outputs.data here
      // returned undefined and would have crashed on first real use.
      const depthOutput = result.outputs.predicted_depth as { data: Float32Array; dims: number[] };
      const rawData = depthOutput.data;
      const dims = depthOutput.dims;
      const outputH = dims[2] as number;
      const outputW = dims[3] as number;

      const decoded = decodeDepthOutput(
        rawData,
        outputW,
        outputH,
        imageData.width,
        imageData.height,
      );

      setDepthMap(decoded.depthMap);
      setDepthWidth(decoded.width);
      setDepthHeight(decoded.height);
      setDepthState('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Depth inference failed';
      setInferenceError(msg);
      setDepthState('error');
    }
  }, [src]);

  const handleRegenerate = useCallback(() => {
    setDepthMap(null);
    setDepthState('idle');
    setInferenceError(null);
  }, []);

  const handleApply = useCallback(async () => {
    if (!depthMap || depthState !== 'ready' || !src) return;
    setInferenceError(null);
    try {
      const imageData = await loadImageToImageData(src);
      const depthResized = new Uint8Array(imageData.width * imageData.height);
      const xRatio = depthWidth / imageData.width;
      const yRatio = depthHeight / imageData.height;
      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          const sx = Math.min(Math.floor(x * xRatio), depthWidth - 1);
          const sy = Math.min(Math.floor(y * yRatio), depthHeight - 1);
          depthResized[y * imageData.width + x] = depthMap[sy * depthWidth + sx]!;
        }
      }

      const result = applyLensBlur(imageData, depthResized, {
        blurAmount: params.blurAmount,
        focalDepth: params.focalDepth / 100,
        transitionRange: params.transitionRange / 100,
        invert: params.invert,
      });

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = result.width;
      outputCanvas.height = result.height;
      const outputCtx = outputCanvas.getContext('2d');
      if (!outputCtx) throw new Error('Canvas 2D context unavailable');
      outputCtx.putImageData(result, 0, 0);
      const dataUrl = outputCanvas.toDataURL('image/png');

      const { insertDerivedImageShape } = await import('../../../imageOperations');
      const currentDoc = state.document;
      const sourceId = state.selection[0];
      if (!sourceId) throw new Error('No selection');
      const sourceNode = currentDoc.nodes[sourceId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, sourceId, {
        dataUrl,
        width: result.width,
        height: result.height,
        suffix: `lens-blur-${Math.round(params.blurAmount)}`,
      });
      updateDoc(() => inserted.doc);
      announce(`Lens blur applied (blur ${params.blurAmount}px, focal ${params.focalDepth}%)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setInferenceError(msg);
    }
  }, [depthMap, depthState, depthWidth, depthHeight, params, src]);

  if (!node || !isImageShape(node)) return null;

  const showBlurControls = depthState === 'ready' && depthMap !== null;

  return (
    <DisclosureSection title="Lens Blur" sectionId="lens-blur">
      <div className="insp-field-group">
        {modelState === 'idle' && (
          <div className="insp-actions">
            <Button type="button" variant="primary" size="sm" onClick={handleDownloadModel}>
              Enable Lens Blur
            </Button>
            <p className="insp-hint">
              One-time download (~27 MB) to analyze depth in your photo. Stored on this device —
              works offline afterward.
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

        {modelState === 'ready' && depthState === 'idle' && (
          <div className="insp-actions">
            <Button type="button" variant="primary" size="sm" onClick={handleGenerateDepth}>
              Generate Depth Map
            </Button>
            <p className="insp-hint">
              Analyzes the photo to estimate depth, which drives the blur below.
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

        {depthMap && depthState === 'ready' && (
          <>
            <p className="insp-subsection__label">Depth Map Preview</p>
            <div className="insp-depth-heatmap">
              <canvas
                ref={heatmapCanvasRef}
                className="insp-depth-heatmap__canvas"
                aria-label="Depth map heatmap overlay"
              />
            </div>

            <div className="insp-actions">
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
              <span>Invert focus (near vs. far)</span>
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
                Apply Lens Blur
              </Button>
            </div>
          </>
        )}
      </div>
    </DisclosureSection>
  );
}
