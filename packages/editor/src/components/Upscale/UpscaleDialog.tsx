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
  type AutoAnalysis,
  analyzeImageForRestoration,
  DEFAULT_UPSCALE_MODE,
  detectUpscaleCapabilities,
  getModelLoader,
  getUpscaleMode,
  isRestorationOperationAvailable,
  RESTORATION_CAPABILITIES,
  type RestorationErrorCode,
  type RestorationStageState,
  recommendationLabel,
  runRestoration,
  toRestorationError,
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
  /** Number of selected images to enhance (batch). Preview shows the first. */
  batchCount?: number;
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
    qualityPolicy: 'faithful' | 'balanced';
    denoiseStrength: DenoiseStrength;
    deblurStrength?: number;
    pixelArtAlgorithm?: PixelArtAlgorithm;
    onProgress: UpscaleProgressFn;
    onStageChange: (stages: RestorationStageState[]) => void;
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

function errorActionForCode(code: RestorationErrorCode): string | null {
  switch (code) {
    case 'model-not-installed':
      return 'Download the required model to continue.';
    case 'hash-mismatch':
      return 'The downloaded model failed integrity verification. Re-download it.';
    case 'dimension-limit':
      return 'The image is too large for this operation. Try a smaller scale or crop.';
    case 'tensor-allocation':
      return 'Not enough memory. Try a smaller scale, close other documents, or restart the app.';
    case 'runtime-unavailable':
      return 'The AI runtime is not available in this environment. Try a classical (CPU) mode.';
    case 'cancelled':
      return null;
    case 'stale-result':
      return 'The source image changed before processing finished. Re-apply on the current selection.';
    default:
      return null;
  }
}

export function UpscaleDialog({
  sourceWidth,
  sourceHeight,
  sourceDataUrl,
  sourceImageData,
  batchCount = 1,
  open,
  onClose,
  onApply,
}: UpscaleDialogProps) {
  const { announce } = useEditor();
  const [modeId, setModeId] = useState<UpscaleModeId>(DEFAULT_UPSCALE_MODE);
  const [operation, setOperation] = useState<RestorationOperation | 'auto'>('auto');
  const [scale, setScale] = useState(2);
  const [output, setOutput] = useState<OutputBehavior>('new-layer');
  const [qualityPolicy, setQualityPolicy] = useState<'faithful' | 'balanced'>('faithful');
  const [denoiseStrength, setDenoiseStrength] = useState<DenoiseStrength>('none');
  const [deblurStrength, setDeblurStrength] = useState(0.7);
  const [pixelArtAlgorithm, setPixelArtAlgorithm] = useState<PixelArtAlgorithm>('epx');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stages, setStages] = useState<RestorationStageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RestorationErrorCode | null>(null);
  const [capabilities, setCapabilities] = useState<{ pathDescription: string } | null>(null);
  const [previewPosition, setPreviewPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | '100%'>('fit');
  // Fractional center of the preview crop (0–1). Defaults to the image
  // center; the 3x3 picker lets the user inspect edges and corners where
  // defects the center crop would hide often live.
  const [previewFocus, setPreviewFocus] = useState({ x: 0.5, y: 0.5 });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  // The same region as `previewDataUrl`, straight from the source. Comparing
  // the upscale against this (rather than the whole image) is what makes the
  // slider meaningful — both halves show the same pixels at the same size.
  const [previewBaselineUrl, setPreviewBaselineUrl] = useState<string | null>(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewSliderRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const mode = useMemo(() => getUpscaleMode(modeId), [modeId]);

  /**
   * Resolve Auto once and reuse that result for preview, model checks, output
   * sizing, and apply. Showing an unchanged preview and then applying a
   * different operation makes restoration especially hard to judge.
   */
  const [autoAnalysis, setAutoAnalysis] = useState<AutoAnalysis | null>(null);
  const resolveAutoOperation = useCallback((): {
    operation: RestorationOperation | null;
    note?: string;
  } => {
    if (!autoAnalysis || autoAnalysis.recommendation[0] === 'none') return { operation: null };
    const { recommendation } = autoAnalysis;

    // Compression restoration has no validated model — drop it from the
    // recommendation and note the gap only when it was the sole signal.
    const hasCompression = recommendation.includes('compression-restoration');
    const filtered = recommendation.filter((r) => r !== 'compression-restoration');
    if (filtered.length === 0 && hasCompression) {
      return {
        operation: null,
        note: 'Compression-artifact cleanup is not yet available. Denoise can reduce some artifacts but is not a dedicated restoration.',
      };
    }

    const restore = filtered.find((r) => r === 'deblur' || r === 'denoise') ?? null;
    const upscale = filtered.includes('upscale');
    if (!restore) return { operation: upscale ? 'upscale' : null };
    if (upscale) {
      return { operation: restore === 'deblur' ? 'deblur-upscale' : 'restore-upscale' };
    }
    return { operation: restore };
  }, [autoAnalysis]);

  const effectiveOperation: RestorationOperation | null =
    operation === 'auto' ? resolveAutoOperation().operation : operation;
  // Availability comes from the validated capability registry, not a
  // hardcoded per-operation rule, so a task lights up the moment its
  // checkpoint passes validation and lands in the manifest.
  const operationAvailable = useMemo(() => {
    if (operation === 'auto') return true;
    return isRestorationOperationAvailable(operation);
  }, [operation]);
  const usesUpscale =
    effectiveOperation === 'upscale' ||
    effectiveOperation === 'restore-upscale' ||
    effectiveOperation === 'deblur-upscale';
  const usesDenoise = effectiveOperation === 'denoise' || effectiveOperation === 'restore-upscale';

  const buildRestorationRequest = useCallback((): RestorationRequest => {
    const method = mode?.id === 'pixel-art' ? 'pixel-art' : (mode?.method ?? 'bicubic');
    const activeOperation: RestorationOperation = effectiveOperation ?? 'none';
    return {
      operation: activeOperation,
      denoise: usesDenoise
        ? { strength: denoiseStrength === 'none' ? 'medium' : denoiseStrength }
        : undefined,
      deblur:
        effectiveOperation === 'deblur' || effectiveOperation === 'deblur-upscale'
          ? { strength: deblurStrength }
          : undefined,
      upscale: usesUpscale
        ? {
            method,
            scale,
            modelId:
              mode?.id === 'illustration'
                ? 'upscale-realesrgan-anime'
                : mode?.id === 'ai-enhance'
                  ? 'upscale-realesr-general'
                  : undefined,
            pixelArtAlgorithm: mode?.id === 'pixel-art' ? pixelArtAlgorithm : undefined,
          }
        : undefined,
      qualityPolicy,
      preview: true,
      previewMaxDimension: 512,
    };
  }, [
    denoiseStrength,
    deblurStrength,
    effectiveOperation,
    mode,
    pixelArtAlgorithm,
    qualityPolicy,
    scale,
    usesDenoise,
    usesUpscale,
  ]);

  // Model prerequisites. Denoise needs SCUNet, Deblur needs the NAFNet
  // checkpoint, and the AI modes need their Real-ESRGAN weights; the CPU
  // resampling modes need nothing. Checking here means a missing model is
  // offered as a download up front instead of surfacing as a backend
  // failure after the user commits to the operation.
  // Anime mode uses the validated anime-optimized model; CPU resampling
  // modes need nothing.
  const requiredModelIds = useMemo(() => {
    const ids: string[] = [];
    if (usesDenoise) ids.push('scunet');
    if (effectiveOperation === 'deblur' || effectiveOperation === 'deblur-upscale') {
      ids.push('nafnet-deblur-gopro');
    }
    if (usesUpscale && mode?.isAi) {
      ids.push(modeId === 'illustration' ? 'upscale-realesrgan-anime' : 'upscale-realesr-general');
    }
    return ids;
  }, [effectiveOperation, mode?.isAi, modeId, usesDenoise, usesUpscale]);
  const [missingModelIds, setMissingModelIds] = useState<string[]>([]);
  const modelMissing = missingModelIds.length > 0;
  // The first missing model is the actionable one shown by the download
  // dialog. Combined restoration operations may require two or more models;
  // after one completes, the next remains disabled until it is acquired.
  const requiredModelId = missingModelIds[0] ?? requiredModelIds[0] ?? null;
  const [showModelDownload, setShowModelDownload] = useState(false);

  // Auto mode: run the cheap classical analysis once per open/source change.
  useEffect(() => {
    if (!open || operation !== 'auto' || !sourceImageData) {
      setAutoAnalysis(null);
      return;
    }
    let cancelled = false;
    // Keep analysis off the critical path; it samples at most 64 patches.
    const id = requestIdleCallback(() => {
      const analysis = analyzeImageForRestoration(sourceImageData, { lowResolutionShortEdge: 900 });
      if (!cancelled) setAutoAnalysis(analysis);
    });
    return () => {
      cancelled = true;
      cancelIdleCallback(id);
    };
  }, [open, operation, sourceImageData]);

  useEffect(() => {
    if (!open || requiredModelIds.length === 0) {
      setMissingModelIds([]);
      return;
    }
    let cancelled = false;
    void Promise.all(requiredModelIds.map((id) => getModelLoader().isModelAvailable(id)))
      .then((available) => {
        if (!cancelled) {
          setMissingModelIds(requiredModelIds.filter((_id, index) => !available[index]));
        }
      })
      .catch(() => {
        if (!cancelled) setMissingModelIds(requiredModelIds);
      });
    return () => {
      cancelled = true;
    };
  }, [open, requiredModelIds]);

  const outW = !usesUpscale ? sourceWidth : Math.round(sourceWidth * scale);
  const outH = !usesUpscale ? sourceHeight : Math.round(sourceHeight * scale);
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
    deblurStrength,
    effectiveOperation,
    open,
    sourceImageData,
    mode,
    processing,
    previewFocus,
    pixelArtAlgorithm,
    qualityPolicy,
  ]);

  // Clear preview when the operation changes or becomes unavailable.
  // Stale preview data from a previous operation must not persist while
  // the new preview is generating (250ms debounce + processing).
  useEffect(() => {
    setPreviewDataUrl(null);
    setPreviewBaselineUrl(null);
  }, [
    operation,
    operationAvailable,
    modeId,
    scale,
    denoiseStrength,
    deblurStrength,
    pixelArtAlgorithm,
    qualityPolicy,
    previewFocus,
  ]);

  async function generatePreview() {
    // Never contend with a running upscale for the native backend's single job
    // slot — registering a preview job there cancels the real one.
    if (!sourceImageData || !mode || !operationAvailable || processing) return;
    const abort = new AbortController();
    previewAbortRef.current = abort;
    setPreviewGenerating(true);
    try {
      // User-selected preview region: crop the source to the focused area
      // FIRST, then run the pipeline on that crop. runRestoration's own
      // center-crop becomes a no-op because the focused crop already fits
      // the preview budget, so preview and final share identical math.
      const region = upscalePreviewRegion(sourceImageData, {
        scale: usesUpscale ? scale : 1,
        previewMaxDimension: 512,
        previewFocus,
      });
      const focusedSource = new ImageData(region.width, region.height);
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          const from = ((region.y + y) * sourceImageData.width + region.x + x) * 4;
          const to = (y * region.width + x) * 4;
          focusedSource.data[to] = sourceImageData.data[from] as number;
          focusedSource.data[to + 1] = sourceImageData.data[from + 1] as number;
          focusedSource.data[to + 2] = sourceImageData.data[from + 2] as number;
          focusedSource.data[to + 3] = sourceImageData.data[from + 3] as number;
        }
      }
      const result = await runRestoration(focusedSource, buildRestorationRequest(), {
        signal: abort.signal,
      });
      const previewImage = result.imageData;
      const canvas = document.createElement('canvas');
      canvas.width = previewImage.width;
      canvas.height = previewImage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(previewImage, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      // Honest baseline: the same focused crop, upscaled with a neutral
      // high-quality CPU filter to the *same* output dimensions as the
      // enhanced preview. Both halves are then shown at the same pixel
      // size, so the slider reveals the method's actual improvement rather
      // than exaggerating via the browser's default interpolation.
      const cropped = focusedSource;
      // Baseline uses a faithful classical filter at the same scale so
      // dimensions match exactly. Pixel-art uses nearest to preserve hard edges.
      let baselineDataUrl: string | null = null;
      try {
        const { upscaleImageData } = await import('@varve/engine');
        const baselineMethod =
          mode?.id === 'pixel-art' ? 'nearest' : usesUpscale ? 'bicubic' : 'nearest';
        const baselineScale = usesUpscale ? scale : 1;
        let baselineImage: ImageData;
        if (baselineScale === 1 && !usesUpscale) {
          baselineImage = cropped;
        } else {
          baselineImage = upscaleImageData(cropped, {
            method: baselineMethod as 'nearest' | 'bicubic' | 'bilinear' | 'lanczos3',
            scale: baselineScale,
          });
          // If the enhanced preview was AI 4x→downsampled to e.g. 2x,
          // the baseline must also be the same final size to compare honestly.
          if (
            baselineImage.width !== previewImage.width ||
            baselineImage.height !== previewImage.height
          ) {
            baselineImage = upscaleImageData(baselineImage, {
              method: 'lanczos3',
              targetWidth: previewImage.width,
              targetHeight: previewImage.height,
            });
          }
        }
        const bCanvas = document.createElement('canvas');
        bCanvas.width = baselineImage.width;
        bCanvas.height = baselineImage.height;
        const bCtx = bCanvas.getContext('2d');
        if (bCtx) {
          bCtx.putImageData(baselineImage, 0, 0);
          baselineDataUrl = bCanvas.toDataURL('image/png');
        }
      } catch {
        // Fallback to raw crop if classical upscale unavailable
        const fallback = document.createElement('canvas');
        fallback.width = cropped.width;
        fallback.height = cropped.height;
        const fCtx = fallback.getContext('2d');
        if (fCtx) {
          fCtx.putImageData(cropped, 0, 0);
          baselineDataUrl = fallback.toDataURL('image/png');
        }
      }
      if (abort.signal.aborted) return;
      setPreviewBaselineUrl(baselineDataUrl);
      setPreviewDataUrl(dataUrl);
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
  const onStageChange = useCallback((nextStages: RestorationStageState[]) => {
    setStages(nextStages);
  }, []);

  const handleApply = useCallback(async () => {
    if (!mode || memoryExceeded || processing || !operationAvailable) return;
    // Auto resolves its recommendation at apply time; nothing to apply when
    // the analysis suggested no restoration.
    const resolved = operation === 'auto' ? resolveAutoOperation() : null;
    if (operation === 'auto' && !resolved?.operation) {
      const message = resolved?.note ?? 'No specific restoration suggested';
      setError(message);
      setErrorCode(null);
      announce(message);
      return;
    }
    if (resolved?.note) {
      setError(resolved.note);
      setErrorCode(null);
    } else {
      setError(null);
      setErrorCode(null);
    }
    // Retire any queued or in-flight preview first. Both share the native
    // backend's single job slot, so a preview starting after this point would
    // cancel the real upscale.
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setProcessing(true);
    setProgress(null);
    const concreteOp = resolved?.operation ?? (operation === 'auto' ? 'upscale' : operation);
    // The engine reports the actual ordered stages and their status. Do not
    // infer the active stage from a global tile count: restoration and
    // upscaling have different tile totals and some CPU stages have none.
    setStages([]);
    try {
      await onApply({
        // 'auto' is a UI-level selection; the resolver picks the concrete
        // operation. Fall back to plain upscale when it has not resolved.
        operation: concreteOp,
        mode: modeId,
        scale,
        output,
        qualityPolicy,
        denoiseStrength:
          resolved?.operation === 'denoise' ||
          resolved?.operation === 'restore-upscale' ||
          resolved?.operation === 'deblur-upscale'
            ? denoiseStrength
            : usesDenoise
              ? denoiseStrength
              : 'none',
        deblurStrength:
          concreteOp === 'deblur' || concreteOp === 'deblur-upscale' ? deblurStrength : undefined,
        pixelArtAlgorithm: modeId === 'pixel-art' ? pixelArtAlgorithm : undefined,
        onProgress,
        onStageChange,
      });
      onClose();
    } catch (caught) {
      // Tauri commands reject with a bare string, so `instanceof Error` alone
      // would discard the backend's message and report a useless generic.
      const restorationError = toRestorationError(caught);
      const message = restorationError.message;
      console.error(
        'Upscale failed:',
        message,
        'code:',
        restorationError.code,
        '\nthrown value:',
        caught,
        '\nstack:',
        caught instanceof Error ? caught.stack : '(non-Error throw, no stack)',
      );
      if (restorationError.code === 'cancelled') {
        setError('Cancelled');
        setErrorCode('cancelled');
        announce('Enhancement cancelled');
      } else {
        setError(message);
        setErrorCode(restorationError.code);
        announce(`Enhancement failed: ${message}`);
      }
    } finally {
      setProcessing(false);
      setProgress(null);
      setStages([]);
    }
  }, [
    mode,
    operation,
    modeId,
    scale,
    output,
    denoiseStrength,
    deblurStrength,
    pixelArtAlgorithm,
    memoryExceeded,
    processing,
    onApply,
    onClose,
    onProgress,
    onStageChange,
    announce,
    buildRestorationRequest,
    operationAvailable,
    usesDenoise,
    resolveAutoOperation,
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

  const handleSliderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPreviewPosition((p) => Math.max(0, p - (e.shiftKey ? 10 : 2)));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPreviewPosition((p) => Math.min(100, p + (e.shiftKey ? 10 : 2)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPreviewPosition(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPreviewPosition(100);
    }
  }, []);

  const peakMemoryBytes = useMemo(() => {
    const denoisePeak = usesDenoise
      ? (RESTORATION_CAPABILITIES.find((c) => c.id === 'scunet')?.peakMemoryBytes ?? 0)
      : 0;
    const deblurPeak =
      effectiveOperation === 'deblur' || effectiveOperation === 'deblur-upscale'
        ? (RESTORATION_CAPABILITIES.find((c) => c.id === 'nafnet-deblur-gopro')?.peakMemoryBytes ??
          0)
        : 0;
    const aiModelId =
      modeId === 'illustration' ? 'upscale-realesrgan-anime' : 'upscale-realesr-general';
    const aiPeak =
      usesUpscale && mode?.isAi
        ? (RESTORATION_CAPABILITIES.find((c) => c.id === aiModelId)?.peakMemoryBytes ?? 0)
        : 0;
    return Math.max(denoisePeak, deblurPeak, aiPeak);
  }, [effectiveOperation, mode?.isAi, modeId, usesDenoise, usesUpscale]);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  // A tiny source (favicon, icon, glyph) has a tiny intrinsic <img> box, which
  // makes the comparison technically correct but useless to inspect. Fit the
  // source or selected preview crop into a bounded review area while keeping
  // 100% mode genuinely pixel-sized.
  const previewRegion = upscalePreviewRegion(
    { width: Math.max(1, sourceWidth), height: Math.max(1, sourceHeight) },
    {
      scale: usesUpscale ? scale : 1,
      previewMaxDimension: 512,
      previewFocus,
    },
  );
  const previewReferenceWidth = previewBaselineUrl ? previewRegion.width : sourceWidth;
  const previewReferenceHeight = previewBaselineUrl ? previewRegion.height : sourceHeight;
  const previewFitScale = Math.min(
    640 / Math.max(1, previewReferenceWidth),
    180 / Math.max(1, previewReferenceHeight),
  );
  const previewFitStyle =
    previewZoom === 'fit'
      ? {
          width: `${Math.max(1, Math.round(previewReferenceWidth * previewFitScale))}px`,
          height: `${Math.max(1, Math.round(previewReferenceHeight * previewFitScale))}px`,
          maxWidth: 'none',
          maxHeight: 'none',
        }
      : undefined;

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
            <h2 className="upscale-dialog__title">
              Enhance image{batchCount > 1 ? ` (${batchCount} selected)` : ''}
            </h2>
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
              <div className="upscale-preview__toolbar">
                <span className="upscale-preview__toolbar-label">Preview</span>
                <div className="upscale-preview__toolbar-controls">
                  <span className="upscale-preview__control-label">Inspect</span>
                  <fieldset
                    className="upscale-preview__focus-picker"
                    aria-label="Preview region (pick the area to inspect)"
                  >
                    {([0, 0.5, 1] as const).flatMap((fy) =>
                      ([0, 0.5, 1] as const).map((fx) => {
                        const active = previewFocus.x === fx && previewFocus.y === fy;
                        return (
                          <button
                            key={`${fx}-${fy}`}
                            type="button"
                            className={`upscale-preview__focus-cell ${active ? 'upscale-preview__focus-cell--active' : ''}`}
                            aria-pressed={active}
                            aria-label={`Preview ${fy === 0 ? 'top' : fy === 1 ? 'bottom' : 'middle'} ${fx === 0 ? 'left' : fx === 1 ? 'right' : 'center'}`}
                            onClick={() => setPreviewFocus({ x: fx, y: fy })}
                          />
                        );
                      }),
                    )}
                  </fieldset>
                  <span className="upscale-preview__control-label">Zoom</span>
                  <fieldset className="upscale-preview__zoom-toggle" aria-label="Preview zoom">
                    <button
                      type="button"
                      className={`upscale-preview__zoom-btn ${previewZoom === 'fit' ? 'upscale-preview__zoom-btn--active' : ''}`}
                      aria-pressed={previewZoom === 'fit'}
                      onClick={() => setPreviewZoom('fit')}
                    >
                      Fit
                    </button>
                    <button
                      type="button"
                      className={`upscale-preview__zoom-btn ${previewZoom === '100%' ? 'upscale-preview__zoom-btn--active' : ''}`}
                      aria-pressed={previewZoom === '100%'}
                      onClick={() => setPreviewZoom('100%')}
                    >
                      100%
                    </button>
                  </fieldset>
                </div>
              </div>
              <div
                ref={previewContainerRef}
                className={`upscale-preview__image-container ${previewZoom === '100%' ? 'upscale-preview__image-container--zoom100' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <img
                  src={previewBaselineUrl ?? (sourceDataUrl || undefined)}
                  alt="Baseline (same crop at output size for honest comparison)"
                  className="upscale-preview__image upscale-preview__image--original"
                  style={
                    previewFitStyle
                      ? { ...previewFitStyle }
                      : previewZoom === '100%'
                        ? { imageRendering: 'auto' as const }
                        : undefined
                  }
                />
                <div
                  className="upscale-preview__overlay"
                  style={{ clipPath: `inset(0 ${100 - previewPosition}% 0 0)` }}
                >
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Enhanced preview — same crop and output size as original"
                      className="upscale-preview__image upscale-preview__image--upscaled"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain' as const,
                        imageRendering:
                          mode?.id === 'pixel-art' ? ('pixelated' as const) : undefined,
                      }}
                    />
                  ) : mode?.isAi ? (
                    <img
                      src={sourceDataUrl || undefined}
                      alt="AI upscaled preview placeholder"
                      className="upscale-preview__image upscale-preview__image--upscaled"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain' as const,
                        opacity: 0.45,
                      }}
                    />
                  ) : (
                    <img
                      src={sourceDataUrl || undefined}
                      alt="Preview placeholder"
                      className="upscale-preview__image upscale-preview__image--upscaled"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain' as const,
                        opacity: 0.45,
                      }}
                    />
                  )}
                </div>
                <div
                  ref={previewSliderRef}
                  className="upscale-preview__slider"
                  style={{ left: `${previewPosition}%` }}
                  role="slider"
                  aria-label="Before / after comparison"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(previewPosition)}
                  aria-valuetext={`${Math.round(previewPosition)}% enhanced`}
                  tabIndex={0}
                  onKeyDown={handleSliderKeyDown}
                >
                  <div className="upscale-preview__slider-line" />
                  <div className="upscale-preview__slider-handle" aria-hidden="true">
                    <span aria-hidden="true">&lt;-&gt;</span>
                  </div>
                </div>
                <span className="upscale-preview__label upscale-preview__label--before">
                  {previewBaselineUrl ? 'Baseline' : 'Original'}
                </span>
                <span className="upscale-preview__label upscale-preview__label--after">
                  {operation === 'denoise'
                    ? 'Denoised'
                    : operation === 'deblur'
                      ? 'Deblurred'
                      : operation === 'compression-restoration'
                        ? 'Restored'
                        : operation === 'restore-upscale'
                          ? 'Restored + enhanced'
                          : operation === 'deblur-upscale'
                            ? 'Deblurred + enhanced'
                            : 'Enhanced'}
                </span>
                {mode?.isAi && !previewDataUrl && (
                  <p className="upscale-preview__ai-hint">
                    AI preview is opt-in — generates a 512 px crop. Tap Generate to see real output.
                  </p>
                )}
                {previewGenerating && (
                  <div className="upscale-preview__generating" role="status" aria-live="polite">
                    Generating preview…
                  </div>
                )}
              </div>
              <p className="upscale-preview__hint">
                {previewBaselineUrl
                  ? `Honest comparison — same ${previewDataUrl ? '512 px' : 'center'} crop at same output size (${usesUpscale ? (mode?.isAi ? 'AI' : 'bicubic') : 'source'} baseline vs ${mode?.isAi ? 'AI' : (mode?.label ?? 'enhanced')}). Drag or use left/right keys to compare. ${previewZoom === '100%' ? '100% pixel view.' : 'Fit view.'} Output: ${outW}×${outH}px`
                  : `Drag or use left/right keys to compare. Output: ${outW}×${outH}px`}
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
                    { value: 'auto', label: 'Auto / Recommended' },
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
                    const next = value as RestorationOperation | 'auto';
                    setOperation(next);
                    if (next === 'upscale') setDenoiseStrength('none');
                    if (next === 'denoise' && denoiseStrength === 'none') {
                      setDenoiseStrength('medium');
                    }
                  }}
                />
                {operation === 'auto' && (
                  <div className="upscale-auto" role="status" aria-live="polite">
                    {autoAnalysis ? (
                      autoAnalysis.recommendation[0] === 'none' ? (
                        <p className="insp-hint">No specific restoration suggested.</p>
                      ) : (
                        <>
                          <p className="insp-hint">
                            <strong>Detected:</strong>{' '}
                            {autoAnalysis.findings.join('; ').toLowerCase()}
                          </p>
                          <p className="insp-hint">
                            <strong>Recommended:</strong>{' '}
                            {recommendationLabel(autoAnalysis.recommendation)} (confidence{' '}
                            {Math.round(autoAnalysis.confidence * 100)}%)
                          </p>
                        </>
                      )
                    ) : (
                      <p className="insp-hint">Analyzing image…</p>
                    )}
                  </div>
                )}
                {!operationAvailable && operation === 'compression-restoration' && (
                  <p className="insp-hint insp-hint--warn">
                    No JPEG/artifact-removal model has passed the design-content corpus yet. SCUNet
                    denoise damages thin lines and text; the only NAFNet JPEG checkpoint was
                    rejected on provenance. Denoise can reduce some artifacts but is not a dedicated
                    compression restorer. A validated model (e.g. FBCNN) will be added when its ONNX
                    export is verified.
                  </p>
                )}
                {!operationAvailable && operation !== 'compression-restoration' && (
                  <p className="insp-hint insp-hint--warn">
                    No task-specific model is installed and validated for this operation yet.
                  </p>
                )}
              </div>

              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Quality</span>
                <SegmentedControl
                  label="Quality policy"
                  value={qualityPolicy}
                  disabled={processing}
                  options={[
                    { value: 'faithful', label: 'Faithful' },
                    { value: 'balanced', label: 'Balanced' },
                  ]}
                  onChange={(v) => setQualityPolicy(v as 'faithful' | 'balanced')}
                />
                <p className="insp-hint">
                  {qualityPolicy === 'faithful'
                    ? 'Preserve original detail. Lighter restoration, fewer artifacts.'
                    : 'Allow stronger reconstruction for better perceptual results.'}
                </p>
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
                  {modeId === 'illustration' && (
                    <p className="insp-hint">
                      Anime-optimized Real-ESRGAN x4 (6B RRDB blocks) — produces sharper edges and
                      cleaner lines on anime and illustrations than the general model.
                    </p>
                  )}
                  {mode?.isAi && (
                    <div className="upscale-settings__ai-preview">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={previewGenerating || processing}
                        onClick={() => void generatePreview()}
                      >
                        {previewGenerating ? 'Generating…' : 'Generate AI preview'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(usesDenoise || operation === 'upscale') && operation !== 'deblur-upscale' && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Denoise</span>
                  <SegmentedControl
                    label="Denoise strength"
                    value={denoiseStrength}
                    disabled={processing || operation === 'upscale'}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'light', label: 'Light' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'strong', label: 'Strong' },
                    ]}
                    onChange={(v) => setDenoiseStrength(v as DenoiseStrength)}
                  />
                  {operation !== 'upscale' && (
                    <p className="insp-hint">
                      {denoiseStrength === 'none'
                        ? 'No denoising'
                        : `${denoiseStrength} denoise before upscale`}
                    </p>
                  )}
                </div>
              )}

              {(operation === 'deblur' || operation === 'deblur-upscale') && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Deblur</span>
                  <SegmentedControl
                    label="Deblur strength"
                    value={String(deblurStrength)}
                    disabled={processing}
                    options={[
                      { value: '0.3', label: 'Light' },
                      { value: '0.5', label: 'Medium' },
                      { value: '0.7', label: 'Strong' },
                      { value: '0.9', label: 'Maximum' },
                    ]}
                    onChange={(v) => setDeblurStrength(Number(v))}
                  />
                  <p className="insp-hint">
                    {operation === 'deblur-upscale'
                      ? `Deblur strength ${deblurStrength} before upscale`
                      : deblurStrength <= 0.3
                        ? 'Conservative — preserves original detail'
                        : deblurStrength >= 0.9
                          ? 'Maximum — may create ringing on already-sharp images'
                          : `Deblur strength ${deblurStrength}`}
                  </p>
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
                  Output {outW}x{outH}px
                  {outputBytes > 0 && ` ~${formatBytes(outputBytes)}`}
                  {mode?.isAi && ' slow, runs locally'}
                  {peakMemoryBytes > 0 && ` · peak model ~${formatBytes(peakMemoryBytes)}`}
                </span>
                {capabilities && (
                  <span className="insp-hint">Path: {capabilities.pathDescription}</span>
                )}
                {autoAnalysis?.findings.some((f) => f.includes('pixel art')) && (
                  <span className="insp-hint">
                    Hint: limited palette — Pixel Art mode will preserve hard edges (no photographic
                    smoothing).
                  </span>
                )}
                {usesUpscale && mode?.isAi && scale !== 4 && (
                  <span className="insp-hint">
                    AI is fixed 4x — your {scale}x is served as 4x AI then high-quality lanczos3
                    downsample to {outW}x{outH}px.
                  </span>
                )}
              </div>

              {modelMissing && requiredModelId && (
                <div className="upscale-model-missing" role="status">
                  <p className="insp-hint insp-hint--warn">
                    {requiredModelId === 'scunet'
                      ? 'Denoise needs the SCUNet model, which is not installed yet.'
                      : requiredModelId === 'nafnet-deblur-gopro'
                        ? 'Deblur needs the NAFNet model, which is not installed yet.'
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

              {/* Progress — stage-aware */}
              {processing && (
                <div className="upscale-progress" role="status" aria-live="polite">
                  {stages.length > 0 && (
                    <div className="upscale-progress__stages">
                      {stages.map((s) => {
                        const isActive = s.status === 'running';
                        const isDone = s.status === 'completed';
                        const isFailed = s.status === 'failed';
                        return (
                          <span
                            key={s.id}
                            className={`upscale-progress__stage ${isDone ? 'upscale-progress__stage--done' : ''} ${isActive ? 'upscale-progress__stage--active' : ''} ${isFailed ? 'upscale-progress__stage--failed' : ''}`}
                          >
                            <span aria-hidden="true">
                              {isDone
                                ? 'done'
                                : isFailed
                                  ? 'failed'
                                  : isActive
                                    ? 'active'
                                    : 'pending'}
                            </span>{' '}
                            {s.id}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {progress && progress.total > 0 && (
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
                        {(() => {
                          const active = stages.find((s) => s.status === 'running');
                          if (active) return `${active.id} · ${progress.done}/${progress.total}`;
                          const failed = stages.find((s) => s.status === 'failed');
                          return failed
                            ? `${failed.id} failed`
                            : `${progress.done}/${progress.total}`;
                        })()}
                      </span>
                    </div>
                  )}
                  {!progress && <p className="insp-hint">Enhancing image…</p>}
                </div>
              )}

              {error && (
                <div className="upscale-error" role="alert">
                  <p className="insp-hint insp-hint--error">{error}</p>
                  {errorCode && errorActionForCode(errorCode) && (
                    <p className="insp-hint">{errorActionForCode(errorCode)}</p>
                  )}
                  {errorCode === 'model-not-installed' && requiredModelId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModelDownload(true)}
                    >
                      Download model
                    </Button>
                  )}
                  {errorCode === 'hash-mismatch' && requiredModelId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModelDownload(true)}
                    >
                      Re-download model
                    </Button>
                  )}
                  {(errorCode === 'dimension-limit' || errorCode === 'tensor-allocation') && (
                    <p className="insp-hint">
                      Try a smaller output scale or a smaller source crop.
                    </p>
                  )}
                </div>
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
                processing ||
                memoryExceeded ||
                !mode ||
                modelMissing ||
                !operationAvailable ||
                (operation === 'auto' &&
                  (!autoAnalysis || autoAnalysis.recommendation[0] === 'none'))
              }
              loading={processing}
              onClick={() => void handleApply()}
            >
              {operation === 'auto'
                ? 'Apply recommended'
                : operation === 'denoise'
                  ? 'Denoise image'
                  : operation === 'deblur'
                    ? 'Deblur image'
                    : operation === 'compression-restoration'
                      ? 'Clean up image'
                      : operation === 'restore-upscale'
                        ? 'Restore and upscale'
                        : operation === 'deblur-upscale'
                          ? 'Deblur and upscale'
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
            setMissingModelIds((ids) => ids.filter((id) => id !== requiredModelId));
          }}
        />
      )}
    </div>
  );
}
