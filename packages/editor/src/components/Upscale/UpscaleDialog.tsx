/**
 * UpscaleDialog — preview-and-settings modal for image upscaling.
 *
 * Shows a before/after comparison, lets the user pick a mode and scale,
 * previews the output dimensions and estimated memory, and applies the
 * result to the document. Keyboard accessible with FocusTrap and aria-live.
 */

import type {
  DenoiseStrength,
  PixelArtAlgorithm,
  RestorationOperation,
  RestorationRequest,
  UpscaleModeId,
  UpscaleProgressFn,
} from '@varve/engine';
import {
  DEFAULT_UPSCALE_MODE,
  detectUpscaleCapabilities,
  getModelLoader,
  getUpscaleMode,
  isRestorationOperationAvailable,
  runRestoration,
  UPSCALE_MODES,
  upscalePreviewRegion,
} from '@varve/engine';
import { Button, FocusTrap, SegmentedControl, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

type OutputBehavior = 'new-layer' | 'replace-source' | 'non-destructive';

interface UpscaleDialogProps {
  /** Source image natural width. */
  sourceWidth: number;
  /** Source image natural height. */
  sourceHeight: number;
  /** Source image data URL for preview. */
  sourceDataUrl: string;
  /** Source image data for preview computation. */
  sourceImageData?: ImageData;
  /** Whether the dialog is open. */
  open: boolean;
  /** Close handler. */
  onClose: () => void;
  /** Apply handler. */
  onApply: (options: {
    operation: RestorationOperation;
    mode: UpscaleModeId;
    scale: number;
    output: OutputBehavior;
    denoiseStrength: DenoiseStrength;
    pixelArtAlgorithm?: PixelArtAlgorithm;
    onProgress: UpscaleProgressFn;
  }) => Promise<void>;
}

const MEMORY_WARNING_BYTES = 256 * 1024 * 1024;
const MEMORY_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Extract a usable message from an unknown throwable.
 *
 * Tauri `invoke` rejects with the command's `Err(String)` payload rather than an
 * Error instance, so an `instanceof Error` check alone collapses every native
 * backend failure into a single uninformative string.
 */
function normalizeThrownMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === 'string' && caught.trim() !== '') return caught;
  if (caught && typeof caught === 'object') {
    const message = (caught as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return 'Processing failed';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function UpscaleDialog({
  sourceWidth,
  sourceHeight,
  sourceDataUrl,
  sourceImageData,
  open,
  onClose,
  onApply,
}: UpscaleDialogProps) {
  const { announce } = useEditor();
  const [modeId, setModeId] = useState<UpscaleModeId>(DEFAULT_UPSCALE_MODE);
  const [operation, setOperation] = useState<RestorationOperation>('upscale');
  const [scale, setScale] = useState(2);
  const [output, setOutput] = useState<OutputBehavior>('new-layer');
  const [denoiseStrength, setDenoiseStrength] = useState<DenoiseStrength>('none');
  const [pixelArtAlgorithm, setPixelArtAlgorithm] = useState<PixelArtAlgorithm>('epx');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{ pathDescription: string } | null>(null);
  const [previewPosition, setPreviewPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  // The same region as `previewDataUrl`, straight from the source. Comparing
  // the upscale against this (rather than the whole image) is what makes the
  // slider meaningful — both halves show the same pixels at the same size.
  const [previewBaselineUrl, setPreviewBaselineUrl] = useState<string | null>(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const mode = useMemo(() => getUpscaleMode(modeId), [modeId]);
  // Availability comes from the validated capability registry, not a
  // hardcoded per-operation rule, so a task lights up the moment its
  // checkpoint passes validation and lands in the manifest.
  const operationAvailable = useMemo(() => isRestorationOperationAvailable(operation), [operation]);
  const usesUpscale = operation === 'upscale' || operation === 'restore-upscale';
  const usesDenoise = operation === 'denoise' || operation === 'restore-upscale';

  const buildRestorationRequest = useCallback((): RestorationRequest => {
    const method = mode?.id === 'pixel-art' ? 'pixel-art' : (mode?.method ?? 'bicubic');
    return {
      operation,
      denoise: usesDenoise
        ? { strength: denoiseStrength === 'none' ? 'medium' : denoiseStrength }
        : undefined,
      upscale: usesUpscale
        ? {
            method,
            scale,
            modelId:
              mode?.id === 'ai-enhance'
                ? 'upscale-realesr-general'
                : mode?.id === 'illustration'
                  ? 'upscale-realesrgan-anime'
                  : undefined,
            pixelArtAlgorithm: mode?.id === 'pixel-art' ? pixelArtAlgorithm : undefined,
          }
        : undefined,
      preview: true,
      previewMaxDimension: 512,
    };
  }, [denoiseStrength, mode, operation, pixelArtAlgorithm, scale, usesDenoise, usesUpscale]);

  // Model prerequisites. Denoise needs SCUNet and the AI modes need their
  // Real-ESRGAN weights; the CPU resampling modes need nothing. Checking here
  // means a missing model is offered as a download up front instead of
  // surfacing as a backend failure after the user commits to the operation.
  const requiredModelId = usesDenoise
    ? 'scunet'
    : mode?.isAi
      ? modeId === 'illustration'
        ? 'upscale-realesrgan-anime'
        : 'upscale-realesr-general'
      : denoiseStrength !== 'none'
        ? 'scunet'
        : null;
  const [modelMissing, setModelMissing] = useState(false);
  const [showModelDownload, setShowModelDownload] = useState(false);

  useEffect(() => {
    if (!open || !requiredModelId) {
      setModelMissing(false);
      return;
    }
    let cancelled = false;
    void getModelLoader()
      .isModelAvailable(requiredModelId)
      .then((available) => {
        if (!cancelled) setModelMissing(!available);
      })
      .catch(() => {
        if (!cancelled) setModelMissing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, requiredModelId]);

  const outW = !usesUpscale
    ? sourceWidth
    : mode?.isAi
      ? sourceWidth * 4
      : Math.round(sourceWidth * scale);
  const outH = !usesUpscale
    ? sourceHeight
    : mode?.isAi
      ? sourceHeight * 4
      : Math.round(sourceHeight * scale);
  const outputBytes = outW > 0 && outH > 0 ? outW * outH * 4 : 0;
  const memoryWarning = outputBytes > MEMORY_WARNING_BYTES;
  const memoryExceeded = outputBytes > MEMORY_MAX_BYTES;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    detectUpscaleCapabilities().then((c) => {
      setCapabilities({ pathDescription: c.pathDescription });
    });
    return () => {
      previousFocusRef.current?.focus();
      // Cancel any pending preview on close
      previewAbortRef.current?.abort();
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    if (mode) {
      setScale(mode.defaultScale);
    }
  }, [mode]);

  // Debounced preview generation for CPU modes.
  //
  // Previews must never overlap the real upscale: the native backend keeps a
  // single active job slot, and registering a new job flips the previous job's
  // cancellation flag. A preview landing mid-apply would therefore cancel the
  // user's actual upscale, so previews are suppressed while processing.
  useEffect(() => {
    if (!open || !sourceImageData || !mode || !operationAvailable || processing) {
      return;
    }
    // Cancel previous preview
    previewAbortRef.current?.abort();
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
    // Debounce 250ms
    previewTimeoutRef.current = setTimeout(() => {
      generatePreview();
    }, 250);
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [
    modeId,
    scale,
    operation,
    operationAvailable,
    denoiseStrength,
    open,
    sourceImageData,
    mode,
    processing,
  ]);

  // Clear preview when switching to AI mode
  useEffect(() => {
    if (mode?.isAi || !usesUpscale) {
      setPreviewDataUrl(null);
      setPreviewBaselineUrl(null);
    }
  }, [mode?.isAi, usesUpscale]);

  async function generatePreview() {
    // Never contend with a running upscale for the native backend's single job
    // slot — registering a preview job there cancels the real one.
    if (!sourceImageData || !mode || !operationAvailable || processing) return;
    const abort = new AbortController();
    previewAbortRef.current = abort;
    setPreviewGenerating(true);
    try {
      const result = await runRestoration(sourceImageData, buildRestorationRequest(), {
        signal: abort.signal,
      });
      const previewImage = result.imageData;
      const canvas = document.createElement('canvas');
      canvas.width = previewImage.width;
      canvas.height = previewImage.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(previewImage, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');

        // Baseline: the identical source region, drawn at the upscaled size so
        // the browser's own interpolation stands in for "no upscale". Any
        // quality difference the slider reveals is then genuinely the method's.
        const region = upscalePreviewRegion(sourceImageData, {
          scale: usesUpscale ? scale : 1,
          previewMaxDimension: 512,
        });
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = region.width;
        cropCanvas.height = region.height;
        const cropCtx = cropCanvas.getContext('2d');
        let baselineUrl: string | null = null;
        if (cropCtx) {
          const cropped = new ImageData(region.width, region.height);
          for (let y = 0; y < region.height; y += 1) {
            for (let x = 0; x < region.width; x += 1) {
              const from = ((region.y + y) * sourceImageData.width + region.x + x) * 4;
              const to = (y * region.width + x) * 4;
              cropped.data[to] = sourceImageData.data[from] as number;
              cropped.data[to + 1] = sourceImageData.data[from + 1] as number;
              cropped.data[to + 2] = sourceImageData.data[from + 2] as number;
              cropped.data[to + 3] = sourceImageData.data[from + 3] as number;
            }
          }
          cropCtx.putImageData(cropped, 0, 0);
          baselineUrl = cropCanvas.toDataURL('image/png');
        }
        if (abort.signal.aborted) return;
        setPreviewBaselineUrl(baselineUrl);
        setPreviewDataUrl(dataUrl);
      }
    } catch (err) {
      if (normalizeThrownMessage(err) !== 'cancelled') {
        console.error('Preview generation failed:', err);
      }
    } finally {
      setPreviewGenerating(false);
    }
  }

  const onProgress: UpscaleProgressFn = useCallback((done: number, total: number) => {
    setProgress({ done, total });
  }, []);

  const handleApply = useCallback(async () => {
    if (!mode || memoryExceeded || processing || !operationAvailable) return;
    // Retire any queued or in-flight preview first. Both share the native
    // backend's single job slot, so a preview starting after this point would
    // cancel the real upscale.
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setError(null);
    setProcessing(true);
    setProgress(null);
    try {
      await onApply({
        operation,
        mode: modeId,
        scale,
        output,
        denoiseStrength: usesDenoise ? denoiseStrength : 'none',
        pixelArtAlgorithm: modeId === 'pixel-art' ? pixelArtAlgorithm : undefined,
        onProgress,
      });
      onClose();
    } catch (caught) {
      // Tauri commands reject with a bare string, so `instanceof Error` alone
      // would discard the backend's message and report a useless generic.
      const message = normalizeThrownMessage(caught);
      console.error(
        'Upscale failed:',
        message,
        '\nthrown value:',
        caught,
        '\nstack:',
        caught instanceof Error ? caught.stack : '(non-Error throw, no stack)',
      );
      setError(message === 'cancelled' ? 'Cancelled' : message);
      announce(
        message === 'cancelled' ? 'Enhancement cancelled' : `Enhancement failed: ${message}`,
      );
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  }, [
    mode,
    operation,
    modeId,
    scale,
    output,
    denoiseStrength,
    pixelArtAlgorithm,
    memoryExceeded,
    processing,
    onApply,
    onClose,
    onProgress,
    announce,
    buildRestorationRequest,
    operationAvailable,
    usesDenoise,
  ]);

  const handleCancel = useCallback(() => {
    if (!processing) {
      onClose();
    }
  }, [processing, onClose]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !previewContainerRef.current) return;
      const rect = previewContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setPreviewPosition(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  if (!open) return null;

  const modeOptions = UPSCALE_MODES.map((m) => ({
    value: m.id,
    label: m.label,
  }));

  const scaleOptions = (mode?.scaleOptions ?? [2]).map((s) => ({
    value: String(s),
    label: `${s}x`,
  }));

  return (
    <div
      className="upscale-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Enhance image"
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) handleCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !processing) handleCancel();
      }}
    >
      <FocusTrap active={open}>
        <div className="upscale-dialog">
          <div className="upscale-dialog__header">
            <h2 className="upscale-dialog__title">Enhance image</h2>
            <button
              type="button"
              className="upscale-dialog__close"
              onClick={handleCancel}
              aria-label="Close upscale dialog"
              disabled={processing}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="upscale-dialog__body">
            {/* Preview */}
            <div className="upscale-preview">
              <div
                ref={previewContainerRef}
                className="upscale-preview__image-container"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <img
                  src={previewBaselineUrl ?? sourceDataUrl}
                  alt="Original"
                  className="upscale-preview__image upscale-preview__image--original"
                />
                <div
                  className="upscale-preview__overlay"
                  style={{ clipPath: `inset(0 ${100 - previewPosition}% 0 0)` }}
                >
                  {mode?.isAi ? (
                    // AI mode: use CSS-scaled placeholder or real preview if generated
                    previewDataUrl ? (
                      <img
                        src={previewDataUrl}
                        alt="AI upscaled preview"
                        className="upscale-preview__image upscale-preview__image--upscaled"
                        style={{
                          aspectRatio: `${sourceWidth}/${sourceHeight}`,
                          transform: `scale(${outW / sourceWidth}, ${outH / sourceHeight})`,
                          transformOrigin: 'top left',
                          width: `${(outW / sourceWidth) * 100}%`,
                          height: `${(outH / sourceHeight) * 100}%`,
                        }}
                      />
                    ) : (
                      <img
                        src={sourceDataUrl}
                        alt="AI upscaled preview placeholder"
                        className="upscale-preview__image upscale-preview__image--upscaled"
                        style={{
                          aspectRatio: `${sourceWidth}/${sourceHeight}`,
                          transform: `scale(${outW / sourceWidth}, ${outH / sourceHeight})`,
                          transformOrigin: 'top left',
                          width: `${(outW / sourceWidth) * 100}%`,
                          height: `${(outH / sourceHeight) * 100}%`,
                          opacity: 0.6,
                        }}
                      />
                    )
                  ) : // CPU modes: use real preview or fallback to CSS scaling
                  previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Upscaled preview"
                      className="upscale-preview__image upscale-preview__image--upscaled"
                      style={{
                        aspectRatio: `${sourceWidth}/${sourceHeight}`,
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  ) : (
                    <img
                      src={sourceDataUrl}
                      alt="Upscaled preview placeholder"
                      className="upscale-preview__image upscale-preview__image--upscaled"
                      style={{
                        aspectRatio: `${sourceWidth}/${sourceHeight}`,
                        transform: `scale(${outW / sourceWidth}, ${outH / sourceHeight})`,
                        transformOrigin: 'top left',
                        width: `${(outW / sourceWidth) * 100}%`,
                        height: `${(outH / sourceHeight) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="upscale-preview__slider" style={{ left: `${previewPosition}%` }}>
                  <div className="upscale-preview__slider-line" />
                  <div className="upscale-preview__slider-handle" aria-hidden="true">
                    <span aria-hidden="true">|</span>
                  </div>
                </div>
                <span className="upscale-preview__label upscale-preview__label--before">
                  Original
                </span>
                <span className="upscale-preview__label upscale-preview__label--after">
                  Upscaled
                </span>
                {mode?.isAi && !previewDataUrl && (
                  <p className="upscale-preview__ai-hint">
                    AI preview is opt-in. Generate to see real results.
                  </p>
                )}
              </div>
              <p className="upscale-preview__hint">
                {previewBaselineUrl
                  ? `Drag to compare — magnified detail, not the whole image. Output: ${outW}by${outH}px`
                  : `Drag to compare. Output: ${outW}by${outH}px`}
              </p>
            </div>

            {/* Settings */}
            <div className="upscale-settings">
              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Enhancement</span>
                <Select
                  label="Enhancement operation"
                  value={operation}
                  disabled={processing}
                  options={[
                    { value: 'upscale', label: 'Upscale' },
                    { value: 'denoise', label: 'Denoise' },
                    { value: 'restore-upscale', label: 'Restore + Upscale' },
                    {
                      value: 'deblur',
                      label: isRestorationOperationAvailable('deblur')
                        ? 'Deblur'
                        : 'Deblur (not available)',
                    },
                    {
                      value: 'compression-restoration',
                      label: isRestorationOperationAvailable('compression-restoration')
                        ? 'Remove compression artifacts'
                        : 'Remove compression artifacts (not available)',
                    },
                  ]}
                  onChange={(value) => {
                    const next = value as RestorationOperation;
                    setOperation(next);
                    if (next === 'upscale') setDenoiseStrength('none');
                    if (next === 'denoise' && denoiseStrength === 'none') {
                      setDenoiseStrength('medium');
                    }
                  }}
                />
                {!operationAvailable && (
                  <p className="insp-hint insp-hint--warn">
                    No task-specific model is installed and validated for this operation yet.
                  </p>
                )}
              </div>

              {usesUpscale && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Mode</span>
                  <Select
                    label="Upscale quality"
                    value={modeId}
                    disabled={processing}
                    options={modeOptions}
                    onChange={(v) => setModeId(v as UpscaleModeId)}
                  />
                  {mode && <p className="insp-hint">{mode.description}</p>}
                  {mode?.isAi && (
                    <div className="upscale-settings__ai-preview">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={previewGenerating || processing}
                        onClick={() => void generatePreview()}
                      >
                        {previewGenerating ? 'Generating...' : 'Generate AI preview'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(usesDenoise || operation === 'upscale') && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Denoise</span>
                  <SegmentedControl
                    label="Denoise strength"
                    value={denoiseStrength}
                    disabled={processing || mode?.isAi || operation === 'upscale'}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'light', label: 'Light' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'strong', label: 'Strong' },
                    ]}
                    onChange={(v) => setDenoiseStrength(v as DenoiseStrength)}
                  />
                  {!mode?.isAi && operation !== 'upscale' && (
                    <p className="insp-hint">
                      {denoiseStrength === 'none'
                        ? 'No denoising'
                        : `${denoiseStrength} denoise before upscale`}
                    </p>
                  )}
                </div>
              )}

              {usesUpscale && modeId === 'pixel-art' && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Algorithm</span>
                  <Select
                    label="Pixel-art algorithm"
                    value={pixelArtAlgorithm}
                    disabled={processing}
                    options={[
                      { value: 'nearest', label: 'Nearest neighbour' },
                      { value: 'epx', label: 'EPX (smooth diagonals)' },
                      { value: 'scale2x', label: 'Scale2x' },
                      { value: 'scale3x', label: 'Scale3x' },
                      { value: 'scale4x', label: 'Scale4x' },
                      { value: 'hqx', label: 'hqx (high quality)' },
                      { value: 'xbr', label: 'xBR (pattern aware)' },
                    ]}
                    onChange={(v) => setPixelArtAlgorithm(v as PixelArtAlgorithm)}
                  />
                  <p className="insp-hint">
                    {pixelArtAlgorithm === 'nearest'
                      ? 'Hard edges, no smoothing'
                      : pixelArtAlgorithm === 'epx'
                        ? 'Smooth diagonal lines, preserves pixel grid'
                        : pixelArtAlgorithm === 'hqx'
                          ? 'Area-based interpolation for curved edges'
                          : pixelArtAlgorithm === 'xbr'
                            ? 'Pattern-aware scaling for complex pixel art'
                            : 'Pure integer nearest-neighbour scaling'}
                  </p>
                </div>
              )}

              {usesUpscale && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Scale</span>
                  <SegmentedControl
                    label="Scale factor"
                    value={String(scale)}
                    disabled={processing || mode?.lockedScale}
                    options={scaleOptions}
                    onChange={(v) => setScale(Number(v))}
                  />
                </div>
              )}

              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Result</span>
                <SegmentedControl
                  label="Output behavior"
                  value={output}
                  disabled={processing}
                  options={[
                    { value: 'new-layer', label: 'New layer' },
                    { value: 'replace-source', label: 'Replace source' },
                    { value: 'non-destructive', label: 'Non-destructive' },
                  ]}
                  onChange={(v) => setOutput(v as OutputBehavior)}
                />
              </div>

              {/* Output info */}
              <div className="upscale-output-info">
                <span className="insp-hint">
                  Output {outW}by{outH}px
                  {outputBytes > 0 && ` ~${formatBytes(outputBytes)}`}
                  {mode?.isAi && ' slow, runs locally'}
                </span>
                {capabilities && (
                  <span className="insp-hint">Path: {capabilities.pathDescription}</span>
                )}
              </div>

              {modelMissing && requiredModelId && (
                <div className="upscale-model-missing" role="status">
                  <p className="insp-hint insp-hint--warn">
                    {requiredModelId === 'scunet'
                      ? 'Denoise needs the SCUNet model, which is not installed yet.'
                      : 'This mode needs an AI model that is not installed yet.'}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={processing}
                    onClick={() => setShowModelDownload(true)}
                  >
                    Download model
                  </Button>
                </div>
              )}

              {memoryWarning && (
                <p className="insp-hint insp-hint--warn" role="status">
                  {memoryExceeded
                    ? `Output exceeds the safe memory limit (${formatBytes(outputBytes)}). Choose a smaller scale.`
                    : `Large output (~${formatBytes(outputBytes)}). Processing may be slow or exhaust memory on low-RAM systems.`}
                </p>
              )}

              {/* Progress */}
              {processing && progress && progress.total > 0 && (
                <div
                  className="insp-progress"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Enhancement progress"
                >
                  <div className="insp-progress__bar" style={{ width: `${progressPct}%` }} />
                  <span className="insp-progress__label">
                    Step {progress.done}/{progress.total}
                  </span>
                </div>
              )}

              {error && (
                <p className="insp-hint insp-hint--error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>

          <div className="upscale-dialog__footer">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={
                processing || memoryExceeded || !mode || modelMissing || !operationAvailable
              }
              loading={processing}
              onClick={() => void handleApply()}
            >
              {operation === 'denoise'
                ? 'Denoise image'
                : operation === 'restore-upscale'
                  ? 'Restore and upscale'
                  : mode?.isAi
                    ? 'Upscale with AI'
                    : 'Upscale image'}
            </Button>
          </div>

          {/* Screen-reader announcements */}
          <div role="status" aria-live="polite" className="varve-visually-hidden">
            {processing && progress
              ? `Enhancing: step ${progress.done} of ${progress.total}`
              : (error ?? '')}
          </div>
        </div>
      </FocusTrap>

      {showModelDownload && requiredModelId && (
        <ModelDownloadDialog
          modelId={requiredModelId}
          onClose={() => setShowModelDownload(false)}
          onComplete={() => {
            setShowModelDownload(false);
            setModelMissing(false);
          }}
        />
      )}
    </div>
  );
}
