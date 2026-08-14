import {
  type ContentAwareFillQuality,
  type ContentAwareFillResult,
  getModelLoader,
  QUALITY_DESCRIPTIONS,
  QUALITY_LABELS,
  runContentAwareFillPipeline,
} from '@varve/engine';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { insertDerivedImageShape } from '../../imageOperations';
import './ContentAwareFillDialog.css';

const MODEL_ID = 'lama-inpainting';
const DEFAULT_BRUSH_SIZE = 28;

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
  const { state, updateDoc, announce } = useEditor();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const isPaintingRef = useRef(false);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);

  const [quality, setQuality] = useState<ContentAwareFillQuality>('fast');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  type DialogStatus = 'idle' | 'downloading' | 'generating' | 'applying' | 'error';
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ContentAwareFillResult | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [hasMaskStrokes, setHasMaskStrokes] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | 'custom'>('fit');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [maskVisible, setMaskVisible] = useState(true);

  const isProcessing = status === 'generating' || status === 'applying';
  const hasResult = previewDataUrl != null && result != null;
  const modeMissingModel = quality === 'ai' && !modelAvailable;

  const node = nodeId ? state.document.nodes[nodeId] : undefined;
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

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
    setQuality('fast');
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setStatus('idle');
    setErrorMessage(null);
    setResult(null);
    setPreviewDataUrl(null);
    setHasMaskStrokes(false);
    setShowOriginal(false);
    setPreviewZoom('fit');
    setZoomPercent(100);
    setMaskVisible(true);
    setDownloadProgress(0);
    setNaturalSize({ w: 0, h: 0 });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const available = await loader.isModelAvailable(MODEL_ID);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !imageSrc) return;
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

        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        setNaturalSize({ w: nw, h: nh });

        const previewCanvas = previewCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (previewCanvas) {
          previewCanvas.width = nw;
          previewCanvas.height = nh;
          const ctx = previewCanvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
        }
        if (maskCanvas) {
          maskCanvas.width = nw;
          maskCanvas.height = nh;
          const mctx = maskCanvas.getContext('2d');
          if (mctx) {
            mctx.fillStyle = 'black';
            mctx.fillRect(0, 0, nw, nh);
          }
        }
        setHasMaskStrokes(false);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, imageSrc]);

  const centerPreview = useCallback(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
    area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(centerPreview);
    return () => cancelAnimationFrame(frame);
  }, [centerPreview, naturalSize, previewZoom, zoomPercent]);

  const selectFitZoom = useCallback(() => {
    setPreviewZoom('fit');
  }, []);

  const selectOneToOneZoom = useCallback(() => {
    setZoomPercent(100);
    setPreviewZoom('custom');
  }, []);

  const adjustZoom = useCallback((delta: number) => {
    setZoomPercent((current) => Math.max(25, Math.min(400, current + delta)));
    setPreviewZoom('custom');
  }, []);

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
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      if (!hasMaskStrokes) setHasMaskStrokes(true);
    },
    [brushSize, hasMaskStrokes],
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
    setHasMaskStrokes(false);
  }, []);

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
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('generating');
    setErrorMessage(null);

    try {
      const fullData = await loadImageToImageData(imageSrc);
      if (controller.signal.aborted) throw new Error('cancelled');

      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new Error('Paint an area to remove first');

      const fullMaskCanvas = new OffscreenCanvas(fullData.width, fullData.height);
      const fullMaskCtx = fullMaskCanvas.getContext('2d');
      if (!fullMaskCtx) throw new Error('Canvas unavailable');
      fullMaskCtx.imageSmoothingEnabled = false;
      fullMaskCtx.drawImage(maskCanvas, 0, 0, fullData.width, fullData.height);
      const maskImageData = fullMaskCtx.getImageData(0, 0, fullData.width, fullData.height);
      const mask = new Uint8Array(fullData.width * fullData.height);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = maskImageData.data[i * 4]!;
      }

      let modelPath: string | undefined;
      let modelId: string | undefined;
      if (quality === 'ai') {
        const loader = getModelLoader();
        modelPath = (await loader.getModelPath(MODEL_ID, controller.signal)) ?? undefined;
        modelId = MODEL_ID;
        if (!modelPath) throw new Error('AI model not found. Download it first.');
      }

      const fillResult = await runContentAwareFillPipeline({
        imageData: fullData,
        mask,
        maskWidth: fullData.width,
        maskHeight: fullData.height,
        maskOffsetX: 0,
        maskOffsetY: 0,
        quality,
        outputMode: 'new-layer',
        signal: controller.signal,
        onProgress: undefined,
        modelPath,
        modelId,
      });

      if (controller.signal.aborted) throw new Error('cancelled');

      const outCanvas = document.createElement('canvas');
      outCanvas.width = fillResult.imageData.width;
      outCanvas.height = fillResult.imageData.height;
      const rctx = outCanvas.getContext('2d');
      if (!rctx) throw new Error('Canvas unavailable');
      rctx.putImageData(fillResult.imageData, 0, 0);
      const dataUrl = outCanvas.toDataURL('image/png');

      setResult(fillResult);
      setPreviewDataUrl(dataUrl);
      setShowOriginal(false);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Fill generation failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [imageSrc, quality]);

  const handleApply = useCallback(async () => {
    if (!nodeId || !previewDataUrl || !result) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('applying');
    setErrorMessage(null);

    try {
      const currentDoc = state.document;
      const sourceNode = currentDoc.nodes[nodeId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, nodeId, {
        dataUrl: previewDataUrl,
        width: result.width,
        height: result.height,
        suffix: 'filled',
      });
      updateDoc(() => inserted.doc);
      announce(`Content-aware fill created (${result.width} x ${result.height})`);
      onApplied?.();
      onClose();
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [nodeId, previewDataUrl, result, state.document, updateDoc, announce, onApplied, onClose]);

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
                    onChange={() => setQuality(q)}
                    className="caf-dialog__quality-input"
                  />
                  <span className="caf-dialog__quality-label">{QUALITY_LABELS[q]}</span>
                  <span className="caf-dialog__quality-desc">{QUALITY_DESCRIPTIONS[q]}</span>
                </label>
              ))}
            </div>
          </div>

          {quality === 'ai' && !modelAvailable && status !== 'downloading' && (
            <div className="caf-dialog__section">
              <Button type="button" variant="primary" size="sm" onClick={handleDownload}>
                Download AI Model (~208 MB)
              </Button>
              <p className="caf-dialog__hint">One-time download required. Stored locally.</p>
            </div>
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
              className="caf-dialog__range"
              min={8}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </div>

          {!hasResult && (
            <div className="caf-dialog__section">
              <label className="caf-dialog__checkbox">
                <input
                  type="checkbox"
                  checked={maskVisible}
                  onChange={(e) => setMaskVisible(e.target.checked)}
                />
                <span>Show mask overlay</span>
              </label>
            </div>
          )}

          <div className="caf-dialog__section">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearMask}
              disabled={!hasMaskStrokes || isProcessing}
            >
              Clear Paint
            </Button>
          </div>

          <div className="caf-dialog__section caf-dialog__section--grow">
            {isProcessing ? (
              <div className="caf-dialog__status">
                <span aria-live="polite">
                  {status === 'generating' ? 'Removing & filling…' : 'Applying…'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    abortRef.current?.abort();
                    setStatus('idle');
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
                disabled={modeMissingModel || !hasMaskStrokes}
                onClick={handleGenerate}
              >
                {hasResult ? 'Regenerate' : 'Remove && Fill'}
              </Button>
            )}
          </div>

          {status === 'error' && errorMessage && (
            <p className="caf-dialog__error" role="alert">
              {errorMessage}
            </p>
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
            <canvas
              ref={previewCanvasRef}
              className={`caf-dialog__preview-canvas${showOriginal || !hasResult ? ' caf-dialog__preview-canvas--visible' : ''}`}
              style={{
                width:
                  previewZoom === 'custom' && naturalSize.w
                    ? `${(naturalSize.w * zoomPercent) / 100}px`
                    : '100%',
                height:
                  previewZoom === 'custom' && naturalSize.h
                    ? `${(naturalSize.h * zoomPercent) / 100}px`
                    : '100%',
                objectFit: previewZoom === 'custom' ? 'none' : 'contain',
              }}
            />

            {hasResult && previewDataUrl && (
              <img
                src={previewDataUrl}
                alt="Fill result"
                className={`caf-dialog__preview-canvas${!showOriginal ? ' caf-dialog__preview-canvas--visible' : ''}`}
                style={{
                  width:
                    previewZoom === 'custom' && naturalSize.w
                      ? `${(naturalSize.w * zoomPercent) / 100}px`
                      : '100%',
                  height:
                    previewZoom === 'custom' && naturalSize.h
                      ? `${(naturalSize.h * zoomPercent) / 100}px`
                      : '100%',
                  objectFit: previewZoom === 'custom' ? 'none' : 'contain',
                }}
              />
            )}

            {!hasResult && maskVisible && (
              <canvas
                ref={maskCanvasRef}
                className="caf-dialog__mask-canvas"
                style={{
                  opacity: 0.45,
                  width:
                    previewZoom === 'custom' && naturalSize.w
                      ? `${(naturalSize.w * zoomPercent) / 100}px`
                      : '100%',
                  height:
                    previewZoom === 'custom' && naturalSize.h
                      ? `${(naturalSize.h * zoomPercent) / 100}px`
                      : '100%',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            )}
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
        </div>
        <div className="caf-dialog__footer-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
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
