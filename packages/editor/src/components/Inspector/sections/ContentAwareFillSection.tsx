/**
 * ContentAwareFillSection — "AI Fill": paint over an unwanted object or
 * blemish and remove it, with the gap filled by plausible generated
 * content. Offered alongside the existing heuristic Healing Brush tool
 * (spot-heal/patch) rather than replacing it — the heuristic remains a
 * valid fast/offline-cheap fallback when the ~208MB LaMa model isn't
 * downloaded or the removal area is small.
 *
 * Mask painting is self-contained here (a plain brush-on-canvas overlay)
 * rather than reusing the scene graph's raster-mask-asset system, which
 * is a separate, actively-validated subsystem (source identity, staleness
 * tracking, coordinate spaces) built for segmentation masks — piggybacking
 * an unrelated inpaint-region mask onto it would risk violating invariants
 * that system enforces for a different purpose.
 */
import { decodeLamaOutput, getInferenceWorkerHost, getModelLoader } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { pickSoleOutputTensor } from '../../../inferenceOutputs';
import { DisclosureSection } from '../controls/DisclosureSection';

const MODEL_ID = 'lama-inpainting';
const PREVIEW_WIDTH = 260;
const DEFAULT_BRUSH_SIZE = 28;

interface FillState {
  status: 'idle' | 'downloading' | 'generating' | 'applying' | 'error';
  errorMessage: string | null;
  previewDataUrl: string | null;
  modelAvailable: boolean;
  hasMaskStrokes: boolean;
}

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

export function ContentAwareFillSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_WIDTH);

  const [fill, setFill] = useState<FillState>({
    status: 'idle',
    errorMessage: null,
    previewDataUrl: null,
    modelAvailable: false,
    hasMaskStrokes: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@strata/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const available = await loader.isModelAvailable(MODEL_ID);
      if (!cancelled) {
        setFill((prev) => ({ ...prev, modelAvailable: available }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  // Draw the source photo into the preview canvas once its size is known,
  // sizing the mask overlay to match.
  useEffect(() => {
    if (!isImage || !imageSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = imageSrc;
        });
        if (cancelled) return;
        const aspect = img.naturalHeight / img.naturalWidth || 1;
        const h = Math.round(PREVIEW_WIDTH * aspect);
        setPreviewHeight(h);

        const canvas = previewCanvasRef.current;
        if (canvas) {
          canvas.width = PREVIEW_WIDTH;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, PREVIEW_WIDTH, h);
        }
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
          maskCanvas.width = PREVIEW_WIDTH;
          maskCanvas.height = h;
          const mctx = maskCanvas.getContext('2d');
          if (mctx) {
            mctx.fillStyle = 'black';
            mctx.fillRect(0, 0, PREVIEW_WIDTH, h);
          }
        }
        setFill((prev) => ({ ...prev, hasMaskStrokes: false }));
      } catch {
        // Preview is best-effort; generation still validates the image separately.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage, imageSrc]);

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * canvas.width;
      const y = ((clientY - rect.top) / rect.height) * canvas.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      setFill((prev) => (prev.hasMaskStrokes ? prev : { ...prev, hasMaskStrokes: true }));
    },
    [brushSize],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isPaintingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
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
    setFill((prev) => ({ ...prev, hasMaskStrokes: false }));
  }, []);

  const handleDownload = useCallback(async () => {
    setFill((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
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
      setFill((prev) => ({ ...prev, status: 'idle', modelAvailable: true }));
      announce('Content-aware fill model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setFill((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setFill((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const runFill = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{ imageData: ImageData; width: number; height: number }> => {
      if (!imageSrc) throw new Error('No image selected');
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new Error('Paint an area to remove first');

      const fullData = await loadImageToImageData(imageSrc);
      if (signal.aborted) throw new Error('cancelled');

      // Scale the painted mask up to the source image's full resolution,
      // preserving hard edges (no smoothing) so the binary paint region
      // doesn't get anti-aliased into partial mask values.
      const fullMaskCanvas = new OffscreenCanvas(fullData.width, fullData.height);
      const fullMaskCtx = fullMaskCanvas.getContext('2d');
      if (!fullMaskCtx) throw new Error('Canvas unavailable');
      fullMaskCtx.imageSmoothingEnabled = false;
      fullMaskCtx.drawImage(maskCanvas, 0, 0, fullData.width, fullData.height);
      const maskImageData = fullMaskCtx.getImageData(0, 0, fullData.width, fullData.height);

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(MODEL_ID, signal);
      if (!modelPath) throw new Error('Content-aware fill model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'lama',
          modelPath,
          modelId: MODEL_ID,
          imageData: fullData,
          auxImageData: maskImageData,
          reuseSession: true,
        },
        { signal, timeoutMs: 90_000 },
      );

      if (signal.aborted) throw new Error('cancelled');

      const rawOutputs = result.outputs as {
        letterbox?: { offsetX: number; offsetY: number };
      };
      const output = pickSoleOutputTensor(result.outputs as Record<string, unknown>);
      if (!output) throw new Error('Fill inference did not produce an output tensor');
      const outputH = output.dims[2] as number;
      const outputW = output.dims[3] as number;

      const decoded = decodeLamaOutput(
        output.data,
        outputW,
        outputH,
        fullData.width,
        fullData.height,
        rawOutputs.letterbox,
      );
      return { imageData: decoded, width: fullData.width, height: fullData.height };
    },
    [imageSrc],
  );

  const handleGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFill((prev) => ({ ...prev, status: 'generating', errorMessage: null }));

    try {
      const { imageData } = await runFill(controller.signal);
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      setFill((prev) => ({ ...prev, status: 'idle', previewDataUrl: dataUrl }));
      announce('Fill preview ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Fill generation failed';
      setFill((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runFill, announce]);

  const handleApply = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFill((prev) => ({ ...prev, status: 'applying', errorMessage: null }));

    try {
      const { imageData, width, height } = await runFill(controller.signal);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      const { insertDerivedImageShape } = await import('../../../imageOperations');
      const currentDoc = state.document;
      const sourceId = state.selection[0];
      if (!sourceId) throw new Error('No selection');
      const sourceNode = currentDoc.nodes[sourceId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, sourceId, {
        dataUrl,
        width,
        height,
        suffix: 'filled',
      });
      updateDoc(() => inserted.doc);
      announce(`Content-aware fill created (${width} x ${height})`);
      setFill((prev) => ({ ...prev, status: 'idle', previewDataUrl: null }));
      handleClearMask();
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Apply failed';
      setFill((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runFill, state.document, state.selection, updateDoc, announce, handleClearMask]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setFill((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  const handleDismissPreview = useCallback(() => {
    setFill((prev) => ({ ...prev, previewDataUrl: null }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = fill.status === 'generating' || fill.status === 'applying';
  const showPreview = fill.previewDataUrl != null;
  const needsDownload = !fill.modelAvailable && fill.status !== 'downloading';

  return (
    <DisclosureSection title="Content-Aware Fill" sectionId="content-aware-fill">
      <div className="insp-field-group">
        <p className="insp-hint">
          Paint over an object or blemish, then remove it — the gap is filled with plausible
          generated content. Runs locally in a web worker.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download content-aware fill model (~208 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~208 MB download (large model). Stored locally on this device.
            </p>
          </div>
        )}

        {fill.status === 'downloading' && (
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

        {!showPreview && (
          <div style={{ position: 'relative', width: PREVIEW_WIDTH, height: previewHeight }}>
            <canvas
              ref={previewCanvasRef}
              width={PREVIEW_WIDTH}
              height={previewHeight}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
            <canvas
              ref={maskCanvasRef}
              width={PREVIEW_WIDTH}
              height={previewHeight}
              role="img"
              aria-label="Paint over the area you want removed"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0.45,
                mixBlendMode: 'screen',
                cursor: 'crosshair',
                touchAction: 'none',
              }}
            />
          </div>
        )}

        {!showPreview && (
          <div className="insp-field-group">
            <label className="insp-field" htmlFor="content-aware-fill-brush-size">
              <span className="insp-field__label">Brush size</span>
              <input
                id="content-aware-fill-brush-size"
                type="range"
                min={8}
                max={80}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
            </label>
            <div className="insp-actions">
              <Button type="button" variant="ghost" size="sm" onClick={handleClearMask}>
                Clear Paint
              </Button>
            </div>
          </div>
        )}

        {showPreview && (
          <section className="insp-nested-panel" aria-label="Fill preview">
            <p className="insp-subsection__label">Preview</p>
            <div
              className="insp-mask-review"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-sunken) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-sunken) 75%)',
                backgroundSize: '16px 16px',
              }}
            >
              <img
                src={fill.previewDataUrl ?? undefined}
                alt="Fill preview"
                style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain' }}
              />
            </div>
            <p className="insp-hint" role="status">
              Preview generated. Apply to create a full-resolution filled layer.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing}
                loading={fill.status === 'applying'}
                aria-label="Apply fill at full resolution"
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDismissPreview}
                disabled={isProcessing}
              >
                Remove Preview
              </Button>
            </div>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                {fill.status === 'generating' ? 'Removing & filling…' : 'Applying…'}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={needsDownload || !fill.hasMaskStrokes}
              onClick={handleGenerate}
              aria-label="Remove painted area and fill"
            >
              Remove &amp; Fill
            </Button>
          )}
        </div>

        {fill.status === 'error' && fill.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {fill.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
